import Foundation
import HealthKit
import Observation

/// Reads the last 30 days from Apple Health and POSTs daily totals to
/// /api/health/samples, and workouts (runs, rides, gym sessions) to
/// /api/health/activities. WHOOP, Oura, Garmin and MyFitnessPal reach the app
/// through Apple Health, so this is the only device integration.
///
/// Connecting stores the data for the client; whether their coach may see it
/// is a separate yes/no kept on the server (`PUT /api/health/sharing`).
///
/// Sample ids are "<kind>-<YYYY-MM-DD>", so re-sending a day replaces it
/// server-side (the endpoint is idempotent on id). Runs on foreground at most
/// once per 15 minutes, and only after the person opts in.
@Observable
@MainActor
final class HealthSync {
    static let shared = HealthSync()

    private static let optInKey = "jk.health.optIn"
    private static let lastSyncKey = "jk.health.lastSync"
    private static let throttle: TimeInterval = 15 * 60
    private static let days = 30

    private(set) var optedIn: Bool
    private(set) var lastSync: Date?
    private(set) var syncing = false
    private(set) var lastError: String?
    private(set) var lastStored: Int?
    private(set) var lastActivities: Int?

    @ObservationIgnored private let store = HKHealthStore()

    init() {
        optedIn = UserDefaults.standard.bool(forKey: Self.optInKey)
        lastSync = UserDefaults.standard.object(forKey: Self.lastSyncKey) as? Date
    }

    var available: Bool { HKHealthStore.isHealthDataAvailable() }

    private var readTypes: Set<HKObjectType> {
        [
            HKQuantityType(.stepCount),
            HKQuantityType(.activeEnergyBurned),
            HKQuantityType(.restingHeartRate),
            HKQuantityType(.bodyMass),
            HKQuantityType(.distanceWalkingRunning),
            HKCategoryType(.sleepAnalysis),
            HKQuantityType(.heartRate),
            HKQuantityType(.distanceCycling),
            HKQuantityType(.distanceSwimming),
            HKObjectType.workoutType(),
        ]
    }

    /// Connect: ask iOS for read access, record the coach-sharing choice on
    /// the server, remember the opt-in, sync. Returns false if it didn't happen.
    @discardableResult
    func connect(shareWithCoach: Bool) async -> Bool {
        guard available else {
            lastError = "Apple Health isn't available on this device."
            return false
        }
        do {
            try await store.requestAuthorization(toShare: [], read: readTypes)
            try await setSharing(shareWithCoach)
            setOptIn(true)
            lastError = nil
            await sync()
            return true
        } catch {
            lastError = error.readable
            return false
        }
    }

    /// What a read of this phone found, kept on the phone (the demo account).
    struct Preview {
        let stepDays: Int
        let averageSteps: Int?
        let sleepNights: Int
        let averageSleepMinutes: Int?
        let latestWeight: Double?
        let workouts: [HealthActivity]
        var isEmpty: Bool { stepDays == 0 && sleepNights == 0 && latestWeight == nil && workouts.isEmpty }
    }

    /// The demo account is shared (App Review signs in to it too), so nothing
    /// from a real phone may reach it. This runs the real permission sheet
    /// and the real read of the last 30 days, and shows the result on the
    /// phone only: no upload, no opt-in, no background sync.
    func preview() async -> Preview? {
        guard available else {
            lastError = "Apple Health isn't available on this device."
            return nil
        }
        do {
            try await store.requestAuthorization(toShare: [], read: readTypes)
            let samples = try await collect()
            let acts = try await workouts()
            let steps = samples.filter { $0.kind == "steps" && $0.value > 0 }
            let sleep = samples.filter { $0.kind == "sleep" && $0.value > 0 }
            let weight = samples.filter { $0.kind == "weight" }.max { $0.start < $1.start }
            lastError = nil
            return Preview(
                stepDays: steps.count,
                averageSteps: steps.isEmpty ? nil : Int(steps.map(\.value).reduce(0, +) / Double(steps.count)),
                sleepNights: sleep.count,
                averageSleepMinutes: sleep.isEmpty ? nil : Int(sleep.map(\.value).reduce(0, +) / Double(sleep.count)),
                latestWeight: weight?.value,
                workouts: acts.sorted { $0.start > $1.start })
        } catch {
            lastError = error.readable
            return nil
        }
    }

    /// The coach-sharing yes/no. Takes effect on the server at once.
    @discardableResult
    func setSharing(_ share: Bool) async throws -> HealthDevices {
        try await APIClient.shared.send("PUT", "/api/health/sharing", body: SharingInput(share: share))
    }

    /// Stops sending. iOS keeps the read permission until it's changed in
    /// Settings › Health › Data Access.
    func disable() {
        setOptIn(false)
    }

    /// Disconnect and erase everything synced so far (samples and workouts);
    /// sharing goes off with it.
    func disconnectAndErase() async throws {
        let _: HealthDevices = try await APIClient.shared.send("DELETE", "/api/health/data")
        setOptIn(false)
        lastSync = nil
        lastStored = nil
        UserDefaults.standard.removeObject(forKey: Self.lastSyncKey)
    }

    private func setOptIn(_ value: Bool) {
        optedIn = value
        UserDefaults.standard.set(value, forKey: Self.optInKey)
    }

    /// Foreground hook: sync when opted in and the last run is over 15 min old.
    func syncIfDue(force: Bool = false) {
        guard optedIn, available, !syncing, APIClient.shared.token != nil else { return }
        if !force, let lastSync, Date().timeIntervalSince(lastSync) < Self.throttle { return }
        Task { await sync() }
    }

    func sync() async {
        guard optedIn, available, !syncing else { return }
        syncing = true
        defer { syncing = false }
        // People who connected before workouts were read: iOS asks once for what's new.
        if (try? await store.statusForAuthorizationRequest(toShare: [], read: readTypes)) == .shouldRequest {
            try? await store.requestAuthorization(toShare: [], read: readTypes)
        }
        do {
            let samples = try await collect()
            var stored = 0
            for start in stride(from: 0, to: samples.count, by: 200) {
                let chunk = Array(samples[start..<min(start + 200, samples.count)])
                let reply: StoredResponse = try await APIClient.shared.send(
                    "POST", "/api/health/samples", body: HealthSamplesInput(samples: chunk))
                stored += reply.stored
            }
            let activities = try await workouts()
            for start in stride(from: 0, to: activities.count, by: 200) {
                let chunk = Array(activities[start..<min(start + 200, activities.count)])
                let _: StoredResponse = try await APIClient.shared.send(
                    "POST", "/api/health/activities", body: HealthActivitiesInput(activities: chunk))
            }
            lastStored = stored
            lastActivities = activities.count
            lastError = nil
            lastSync = Date()
            UserDefaults.standard.set(lastSync, forKey: Self.lastSyncKey)
        } catch {
            if !error.isCancellation { lastError = error.readable }
        }
    }

    // MARK: Reading

    private func collect() async throws -> [HealthSample] {
        let end = Date()
        let start = Day.add(-(Self.days - 1), to: Day.start(end))
        var out: [HealthSample] = []
        out += try await daily(.stepCount, kind: "steps", unit: .count(), option: .cumulativeSum, from: start, to: end)
        out += try await daily(.activeEnergyBurned, kind: "activeKcal", unit: .kilocalorie(), option: .cumulativeSum,
                               from: start, to: end)
        out += try await daily(.distanceWalkingRunning, kind: "distance", unit: .meterUnit(with: .kilo),
                               option: .cumulativeSum, from: start, to: end)
        out += try await daily(.restingHeartRate, kind: "restingHr", unit: HKUnit.count().unitDivided(by: .minute()),
                               option: .discreteAverage, from: start, to: end)
        out += try await daily(.bodyMass, kind: "weight", unit: .gramUnit(with: .kilo), option: .mostRecent,
                               from: start, to: end)
        out += try await sleep(from: Day.add(-1, to: start), to: end, keepFrom: start)
        return out
    }

    private func daily(_ id: HKQuantityTypeIdentifier, kind: String, unit: HKUnit, option: HKStatisticsOptions,
                       from start: Date, to end: Date) async throws -> [HealthSample] {
        let type = HKQuantityType(id)
        let predicate = HKQuery.predicateForSamples(withStart: start, end: end)
        let descriptor = HKStatisticsCollectionQueryDescriptor(
            predicate: HKSamplePredicate.quantitySample(type: type, predicate: predicate),
            options: option,
            anchorDate: start,
            intervalComponents: DateComponents(day: 1)
        )
        let collection = try await descriptor.result(for: store)
        var samples: [HealthSample] = []
        collection.enumerateStatistics(from: start, to: end) { stats, _ in
            let quantity: HKQuantity?
            if option.contains(.cumulativeSum) {
                quantity = stats.sumQuantity()
            } else if option.contains(.mostRecent) {
                quantity = stats.mostRecentQuantity()
            } else {
                quantity = stats.averageQuantity()
            }
            guard let quantity else { return }
            let value = quantity.doubleValue(for: unit)
            samples.append(HealthSample(id: "\(kind)-\(Day.string(stats.startDate))", kind: kind,
                                        start: stats.startDate, end: stats.endDate,
                                        value: (value * 100).rounded() / 100))
        }
        return samples
    }

    /// The last 30 days of workouts. Ids are HealthKit's own UUIDs, so a
    /// re-sync replaces rather than duplicates.
    private func workouts() async throws -> [HealthActivity] {
        let end = Date()
        let start = Day.add(-(Self.days - 1), to: Day.start(end))
        let descriptor = HKSampleQueryDescriptor(
            predicates: [.workout(HKQuery.predicateForSamples(withStart: start, end: end))],
            sortDescriptors: [SortDescriptor(\.startDate, order: .reverse)],
            limit: 300
        )
        let found = try await descriptor.result(for: store)
        let bpm = HKUnit.count().unitDivided(by: .minute())
        return found.compactMap { w in
            let minutes = w.duration / 60
            guard minutes >= 1 else { return nil }
            let kcal = w.statistics(for: HKQuantityType(.activeEnergyBurned))?.sumQuantity()?.doubleValue(for: .kilocalorie())
            let distance = [HKQuantityTypeIdentifier.distanceWalkingRunning, .distanceCycling, .distanceSwimming]
                .lazy.compactMap { w.statistics(for: HKQuantityType($0))?.sumQuantity()?.doubleValue(for: .meterUnit(with: .kilo)) }
                .first
            let hr = w.statistics(for: HKQuantityType(.heartRate))?.averageQuantity()?.doubleValue(for: bpm)
            let twoPlaces = { (v: Double?) in v.map { ($0 * 100).rounded() / 100 } }
            return HealthActivity(id: w.uuid.uuidString, type: Self.name(w.workoutActivityType), date: nil,
                                  start: w.startDate, end: w.endDate, minutes: (minutes * 10).rounded() / 10,
                                  kcal: twoPlaces(kcal), distanceKm: twoPlaces(distance), avgHr: twoPlaces(hr),
                                  source: String(w.sourceRevision.source.name.prefix(60)))
        }
    }

    static func name(_ type: HKWorkoutActivityType) -> String {
        switch type {
        case .running: return "Running"
        case .walking: return "Walking"
        case .hiking: return "Hiking"
        case .cycling: return "Cycling"
        case .swimming: return "Swimming"
        case .rowing: return "Rowing"
        case .elliptical: return "Elliptical"
        case .stairClimbing, .stairs: return "Stairs"
        case .traditionalStrengthTraining: return "Strength training"
        case .functionalStrengthTraining: return "Functional strength"
        case .highIntensityIntervalTraining: return "HIIT"
        case .crossTraining: return "Cross training"
        case .mixedCardio: return "Mixed cardio"
        case .coreTraining: return "Core training"
        case .yoga: return "Yoga"
        case .pilates: return "Pilates"
        case .flexibility: return "Flexibility"
        case .cooldown: return "Cooldown"
        case .boxing: return "Boxing"
        case .kickboxing: return "Kickboxing"
        case .martialArts: return "Martial arts"
        case .cardioDance, .socialDance: return "Dance"
        case .soccer: return "Football"
        case .rugby: return "Rugby"
        case .tennis: return "Tennis"
        case .golf: return "Golf"
        case .basketball: return "Basketball"
        case .climbing: return "Climbing"
        case .jumpRope: return "Skipping"
        default: return "Workout"
        }
    }

    /// Minutes asleep per night, credited to the day the night ends. Sources
    /// overlap (Watch and Oura both write), so intervals are merged first.
    private func sleep(from start: Date, to end: Date, keepFrom: Date) async throws -> [HealthSample] {
        let predicate = HKQuery.predicateForSamples(withStart: start, end: end)
        let descriptor = HKSampleQueryDescriptor(
            predicates: [.categorySample(type: HKCategoryType(.sleepAnalysis), predicate: predicate)],
            sortDescriptors: [SortDescriptor(\.startDate)]
        )
        let all = try await descriptor.result(for: store)
        let asleep = all.filter { sample in
            guard let value = HKCategoryValueSleepAnalysis(rawValue: sample.value) else { return false }
            return HKCategoryValueSleepAnalysis.allAsleepValues.contains(value)
        }
        var byDay: [String: [(Date, Date)]] = [:]
        for s in asleep where s.endDate >= keepFrom {
            byDay[Day.string(s.endDate), default: []].append((s.startDate, s.endDate))
        }
        return byDay.compactMap { day, intervals in
            let sorted = intervals.sorted { $0.0 < $1.0 }
            var merged: [(Date, Date)] = []
            for interval in sorted {
                if let last = merged.last, interval.0 <= last.1 {
                    merged[merged.count - 1].1 = max(last.1, interval.1)
                } else {
                    merged.append(interval)
                }
            }
            let minutes = merged.reduce(0.0) { $0 + $1.1.timeIntervalSince($1.0) / 60 }
            guard minutes > 0, let first = merged.first, let last = merged.last else { return nil }
            return HealthSample(id: "sleep-\(day)", kind: "sleep", start: first.0, end: last.1, value: minutes.rounded())
        }
    }
}

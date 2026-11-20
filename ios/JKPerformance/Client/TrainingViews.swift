import SwiftUI

// MARK: - Workout plan (Plan tab root)

/// "Week 6 of 12 · Block B": a day strip, today's session, its exercises with
/// the coach's prescription.
struct WorkoutPlanView: View {
    @State private var selectedDay = 20

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 14) {
                    ScreenHeader(eyebrow: "Week 6 of 12 · Block B", title: "Workout plan") {
                        NavigationLink { ExercisesView() } label: {
                            Image(systemName: "plus")
                                .frame(width: 30, height: 30)
                                .overlay(RoundedRectangle(cornerRadius: 7).stroke(JK.stroke, lineWidth: 1))
                        }
                        .foregroundStyle(JK.text)
                    }
                    DayStrip(days: Mock.planDays, selected: $selectedDay)

                    VStack(alignment: .leading, spacing: 8) {
                        HStack {
                            Text("Lower Body Strength").font(.headline).foregroundStyle(JK.text)
                            Spacer()
                            Label("Shared with Coach", systemImage: "person.2").font(.caption2).foregroundStyle(JK.tertiary)
                        }
                        Text("5 exercises · ~55 min").font(.caption2).foregroundStyle(JK.tertiary)
                        HStack {
                            ThinBar(fraction: 0.4)
                            Text("2 of 5 done").font(.caption2).foregroundStyle(JK.tertiary)
                        }
                    }
                    .jkCard()

                    ForEach(Mock.planExercises) { item in
                        NavigationLink { WorkoutLoggerView() } label: {
                            PlanExerciseCard(item: item)
                        }
                        .buttonStyle(.plain)
                    }
                }
                .padding(16)
            }
            .jkScreen()
            .toolbar(.hidden, for: .navigationBar)
        }
    }
}

struct DayStrip: View {
    let days: [PlanDay]
    @Binding var selected: Int

    var body: some View {
        HStack(spacing: 6) {
            ForEach(days) { d in
                Button {
                    selected = d.day
                } label: {
                    VStack(spacing: 2) {
                        Text(d.weekday).font(.system(size: 10))
                        Text("\(d.day)").font(.subheadline.weight(.semibold))
                    }
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 8)
                    .foregroundStyle(selected == d.day ? Color.black : JK.text)
                    .background(selected == d.day ? AnyShapeStyle(JK.chrome) : AnyShapeStyle(JK.card),
                                in: RoundedRectangle(cornerRadius: 10, style: .continuous))
                    .overlay(RoundedRectangle(cornerRadius: 10, style: .continuous).stroke(JK.stroke, lineWidth: 1))
                }
                .buttonStyle(.plain)
            }
        }
    }
}

private struct PlanExerciseCard: View {
    let item: PlanExercise

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                CheckCircle(on: item.done)
                Text(item.name).font(.subheadline.weight(.semibold)).foregroundStyle(JK.text)
                Spacer()
                Image(systemName: "pencil").font(.caption).foregroundStyle(JK.tertiary)
            }
            HStack(spacing: 8) {
                PrescriptionCell(label: "Sets", value: item.sets)
                PrescriptionCell(label: "Reps", value: item.reps)
                PrescriptionCell(label: "Load", value: item.load)
            }
            if let note = item.note {
                Label(note, systemImage: "text.bubble").font(.caption2).foregroundStyle(JK.tertiary)
            }
        }
        .jkCard()
    }
}

private struct PrescriptionCell: View {
    let label: String
    let value: String

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(label).font(.system(size: 9)).foregroundStyle(JK.tertiary)
            Text(value).font(.subheadline.weight(.semibold)).foregroundStyle(JK.text)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(8)
        .background(JK.cardRaised, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
    }
}

// MARK: - Exercise library

struct ExercisesView: View {
    @State private var query = ""
    @State private var category = "All"

    private var filtered: [Exercise] {
        Mock.exercises.filter {
            (category == "All" || $0.category == category)
                && (query.isEmpty || $0.name.localizedCaseInsensitiveContains(query))
        }
    }

    private let columns = [GridItem(.flexible(), spacing: 10), GridItem(.flexible(), spacing: 10)]

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                ScreenHeader(eyebrow: "Library", title: "Exercises") {
                    Image(systemName: "line.3.horizontal.decrease")
                        .frame(width: 30, height: 30)
                        .overlay(RoundedRectangle(cornerRadius: 7).stroke(JK.stroke, lineWidth: 1))
                        .foregroundStyle(JK.text)
                }
                HStack {
                    Image(systemName: "magnifyingglass").foregroundStyle(JK.tertiary)
                    TextField("Search 1,240 exercises", text: $query).foregroundStyle(JK.text)
                }
                .jkCard(padding: 10)
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 6) {
                        ForEach(Mock.exerciseCategories, id: \.self) { c in
                            Chip(label: c, selected: category == c) { category = c }
                        }
                    }
                }
                LazyVGrid(columns: columns, spacing: 10) {
                    ForEach(filtered) { exercise in
                        NavigationLink { WorkoutLoggerView() } label: {
                            ExerciseTile(exercise: exercise)
                        }
                        .buttonStyle(.plain)
                    }
                }
                Eyebrow(text: "Recently used")
                VStack(spacing: 0) {
                    ForEach(Mock.recentlyUsed) { exercise in
                        HStack(spacing: 12) {
                            IconTile(systemName: "play.fill", size: 34)
                            VStack(alignment: .leading, spacing: 2) {
                                Text(exercise.name).font(.subheadline.weight(.medium)).foregroundStyle(JK.text)
                                Text("\(exercise.equipment) · \(exercise.pattern)").font(.caption2).foregroundStyle(JK.tertiary)
                            }
                            Spacer()
                            Image(systemName: "plus").foregroundStyle(JK.tertiary)
                        }
                        .padding(10)
                    }
                }
                .jkCard(padding: 4)
            }
            .padding(16)
        }
        .jkScreen()
    }
}

private struct ExerciseTile: View {
    let exercise: Exercise

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            ZStack(alignment: .bottomTrailing) {
                Rectangle().fill(JK.cardRaised).frame(height: 84)
                Image(systemName: "play.circle")
                    .foregroundStyle(JK.secondary)
                    .padding(6)
            }
            VStack(alignment: .leading, spacing: 2) {
                Text(exercise.name).font(.caption.weight(.semibold)).foregroundStyle(JK.text)
                Text("\(exercise.equipment) · \(exercise.pattern)").font(.system(size: 10)).foregroundStyle(JK.tertiary)
            }
            .padding(10)
        }
        .background(JK.card)
        .clipShape(RoundedRectangle(cornerRadius: JK.corner, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: JK.corner, style: .continuous).stroke(JK.stroke, lineWidth: 1))
    }
}

// MARK: - Workout logger

/// Logging one exercise: coach demo, set table, rest timer.
struct WorkoutLoggerView: View {
    @State private var sets = Mock.splitSquatSets
    @State private var rest = 74
    @State private var resting = true

    private var nextSet: Int? { sets.firstIndex { !$0.done } }

    var body: some View {
        ScrollView {
            VStack(spacing: 14) {
                demo
                setTable
                restTimer
                HStack(spacing: 10) {
                    Button {} label: { Label("Send form check", systemImage: "camera") }
                        .buttonStyle(GhostButtonStyle())
                    Button {
                        if let i = nextSet {
                            sets[i].done = true
                            if sets[i].reps == nil { sets[i].reps = 10 }
                            rest = 90
                            resting = true
                        }
                    } label: {
                        Text(nextSet.map { "Log set \(sets[$0].number)" } ?? "All sets logged")
                    }
                    .buttonStyle(ChromeButtonStyle())
                    .disabled(nextSet == nil)
                }
            }
            .padding(16)
        }
        .jkScreen()
        .navigationTitle("Lower Body Strength")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Text("3 of 5").font(.caption2).foregroundStyle(JK.tertiary)
            }
        }
        .task(id: resting) {
            while resting && rest > 0 && !Task.isCancelled {
                try? await Task.sleep(for: .seconds(1))
                if resting && rest > 0 { rest -= 1 }
            }
        }
    }

    private var demo: some View {
        VStack(alignment: .leading, spacing: 0) {
            ZStack(alignment: .bottomLeading) {
                Rectangle().fill(JK.cardRaised).frame(height: 150)
                Image(systemName: "play.fill")
                    .foregroundStyle(JK.text)
                    .frame(width: 44, height: 44)
                    .background(JK.card, in: Circle())
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                Text("Coach demo · 0:42")
                    .font(.caption2)
                    .padding(.horizontal, 8).padding(.vertical, 3)
                    .background(JK.card, in: Capsule())
                    .foregroundStyle(JK.secondary)
                    .padding(10)
            }
            .frame(height: 150)
            VStack(alignment: .leading, spacing: 2) {
                Text("Bulgarian Split Squat").font(.title3.weight(.semibold)).foregroundStyle(JK.text)
                Text("3 × 10 / leg · 2×20 kg · RPE 7–8").font(.caption).foregroundStyle(JK.tertiary)
            }
            .padding(14)
        }
        .background(JK.card)
        .clipShape(RoundedRectangle(cornerRadius: JK.corner, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: JK.corner, style: .continuous).stroke(JK.stroke, lineWidth: 1))
    }

    private var setTable: some View {
        VStack(spacing: 0) {
            HStack {
                Text("SET").frame(width: 34, alignment: .leading)
                Text("PREVIOUS").frame(maxWidth: .infinity, alignment: .leading)
                Text("KG").frame(width: 56)
                Text("REPS").frame(width: 44)
                Spacer().frame(width: 28)
            }
            .font(.system(size: 9, weight: .semibold))
            .foregroundStyle(JK.tertiary)
            .padding(.horizontal, 12).padding(.vertical, 10)

            ForEach($sets) { $row in
                HStack {
                    Text("\(row.number)").font(.subheadline.weight(.semibold)).frame(width: 34, alignment: .leading)
                    Text(row.previous).font(.caption).foregroundStyle(JK.tertiary).frame(maxWidth: .infinity, alignment: .leading)
                    Text(row.load).font(.subheadline.weight(.semibold)).frame(width: 56)
                    Text(row.reps.map { "\($0)" } ?? "–")
                        .font(.subheadline.weight(.semibold))
                        .frame(width: 36, height: 28)
                        .background(JK.cardRaised, in: RoundedRectangle(cornerRadius: 6))
                        .frame(width: 44)
                    Button {
                        row.done.toggle()
                    } label: {
                        Image(systemName: row.done ? "checkmark.square.fill" : "square")
                            .font(.title3)
                            .foregroundStyle(row.done ? JK.text : JK.tertiary)
                    }
                    .buttonStyle(.plain)
                    .frame(width: 28)
                }
                .foregroundStyle(JK.text)
                .padding(.horizontal, 12).padding(.vertical, 8)
            }
        }
        .jkCard(padding: 0)
    }

    private var restTimer: some View {
        HStack(spacing: 12) {
            ZStack {
                Circle().stroke(JK.track, lineWidth: 4)
                Circle().trim(from: 0, to: Double(rest) / 90).stroke(JK.text, style: StrokeStyle(lineWidth: 4, lineCap: .round)).rotationEffect(.degrees(-90))
            }
            .frame(width: 38, height: 38)
            VStack(alignment: .leading, spacing: 0) {
                Text("REST").font(.system(size: 9, weight: .semibold)).foregroundStyle(JK.tertiary)
                Text(String(format: "%d:%02d", rest / 60, rest % 60))
                    .font(.title.weight(.semibold).monospacedDigit())
                    .foregroundStyle(JK.text)
            }
            Spacer()
            Button("−15s") { rest = max(0, rest - 15) }.buttonStyle(SmallPillStyle())
            Button("+15s") { rest += 15 }.buttonStyle(SmallPillStyle())
            Button { resting.toggle() } label: {
                Image(systemName: resting ? "pause" : "play")
            }
            .buttonStyle(SmallPillStyle())
        }
        .jkCard()
    }
}

struct SmallPillStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.caption2.weight(.semibold))
            .foregroundStyle(JK.secondary)
            .padding(.horizontal, 10).padding(.vertical, 6)
            .background(JK.cardRaised, in: Capsule())
            .overlay(Capsule().stroke(JK.stroke, lineWidth: 1))
            .opacity(configuration.isPressed ? 0.6 : 1)
    }
}

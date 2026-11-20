import Charts
import SwiftUI

// MARK: - Today (coach tab root)

struct CoachTodayView: View {
    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 14) {
                    ScreenHeader(eyebrow: "Coach · Fri 20 Nov", title: "Today") {
                        HStack(spacing: 12) {
                            Image(systemName: "bell").foregroundStyle(JK.secondary)
                            NavigationLink { BusinessView() } label: {
                                Text("JK")
                                    .font(.caption.weight(.bold))
                                    .frame(width: 30, height: 30)
                                    .overlay(RoundedRectangle(cornerRadius: 7).stroke(JK.secondary, lineWidth: 1))
                            }
                            .foregroundStyle(JK.text)
                        }
                    }
                    HStack(spacing: 8) {
                        StatTile(label: "Sessions", value: "5")
                        StatTile(label: "Active clients", value: "18")
                        StatTile(label: "Unread", value: "3")
                    }

                    Eyebrow(text: "Client obligations", trailing: "View week")
                    ForEach(Mock.obligations) { o in
                        HStack(spacing: 12) {
                            VStack(alignment: .leading, spacing: 0) {
                                Text(o.start).font(.caption2.weight(.semibold))
                                Text(o.end).font(.system(size: 9)).foregroundStyle(JK.tertiary)
                            }
                            .frame(width: 38, alignment: .leading)
                            .foregroundStyle(o.done ? JK.tertiary : JK.text)
                            NavigationLink { ClientDetailView() } label: {
                                HStack(spacing: 10) {
                                    Avatar(initials: o.initials, size: 28)
                                    VStack(alignment: .leading, spacing: 1) {
                                        Text(o.name).font(.subheadline.weight(.semibold))
                                        Text(o.detail).font(.caption2).foregroundStyle(JK.tertiary)
                                    }
                                    Spacer()
                                    if o.next {
                                        Text("Next")
                                            .font(.system(size: 9, weight: .semibold))
                                            .padding(.horizontal, 7).padding(.vertical, 3)
                                            .background(JK.text, in: Capsule())
                                            .foregroundStyle(.black)
                                    } else if o.done {
                                        Image(systemName: "checkmark").font(.caption)
                                    } else {
                                        Image(systemName: "chevron.right").font(.caption).foregroundStyle(JK.tertiary)
                                    }
                                }
                                .foregroundStyle(o.done ? JK.tertiary : JK.text)
                                .padding(10)
                                .background(JK.card, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                                .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous)
                                    .stroke(o.next ? JK.secondary : JK.stroke, lineWidth: 1))
                            }
                        }
                    }

                    HStack(alignment: .top, spacing: 12) {
                        IconTile(systemName: "lightbulb", size: 32)
                        VStack(alignment: .leading, spacing: 2) {
                            Text("Tip of the day").font(.caption.weight(.semibold)).foregroundStyle(JK.text)
                            Text("Open each 1:1 with one question about sleep. It predicts session quality better than mood.")
                                .font(.caption2).foregroundStyle(JK.tertiary)
                        }
                    }
                    .jkCard()
                }
                .padding(16)
            }
            .jkScreen()
            .toolbar(.hidden, for: .navigationBar)
        }
    }
}

// MARK: - Business

struct BusinessView: View {
    enum Period: String, CaseIterable { case week = "Week", month = "Month" }
    @State private var period: Period = .month

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                ScreenHeader(eyebrow: "Coach · November", title: "Business") {
                    Segmented(options: Period.allCases, selection: $period) { $0.rawValue }.frame(width: 120)
                }
                VStack(alignment: .leading, spacing: 6) {
                    HStack {
                        Eyebrow(text: "Monthly recurring revenue")
                        Spacer()
                        DeltaBadge(text: "+12%")
                    }
                    Text("£2,486").font(.largeTitle.weight(.semibold)).foregroundStyle(JK.text)
                    Chart(Mock.mrr) { p in
                        AreaMark(x: .value("Day", p.day), y: .value("£", p.kg))
                            .foregroundStyle(LinearGradient(colors: [JK.text.opacity(0.3), .clear], startPoint: .top, endPoint: .bottom))
                        LineMark(x: .value("Day", p.day), y: .value("£", p.kg)).foregroundStyle(JK.text)
                    }
                    .chartYScale(domain: 1700...2550)
                    .chartXAxis(.hidden)
                    .chartYAxis(.hidden)
                    .frame(height: 90)
                }
                .jkCard()
                HStack(spacing: 8) {
                    StatTile(label: "Active", value: "18")
                    StatTile(label: "New", value: "2")
                    StatTile(label: "Churned", value: "1")
                    StatTile(label: "Adherence", value: "86%")
                }
                Eyebrow(text: "Needs attention", trailing: "Auto-flagged")
                VStack(spacing: 0) {
                    ForEach(Mock.attention) { item in
                        HStack(spacing: 12) {
                            Avatar(initials: item.initials)
                            VStack(alignment: .leading, spacing: 2) {
                                Text(item.name).font(.subheadline.weight(.semibold))
                                Text(item.reason).font(.caption2).foregroundStyle(JK.tertiary)
                            }
                            Spacer()
                            Image(systemName: item.systemName).font(.caption).foregroundStyle(JK.secondary)
                        }
                        .foregroundStyle(JK.text)
                        .padding(12)
                    }
                }
                .jkCard(padding: 2)
                HStack(spacing: 10) {
                    Button {} label: { Label("Nudge all 3", systemImage: "bubble.left") }
                    Button {} label: { Label("Full report", systemImage: "chart.bar") }
                }
                .buttonStyle(GhostButtonStyle())
            }
            .padding(16)
        }
        .jkScreen()
    }
}

// MARK: - Clients (coach tab root)

struct ClientsView: View {
    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 14) {
                    ScreenHeader(eyebrow: "Coach", title: "Clients") {
                        NavigationLink { ProgramsView() } label: {
                            Label("Programs", systemImage: "square.stack")
                                .font(.caption.weight(.semibold))
                                .padding(.horizontal, 10).padding(.vertical, 6)
                                .overlay(Capsule().stroke(JK.stroke, lineWidth: 1))
                        }
                        .foregroundStyle(JK.text)
                    }
                    VStack(spacing: 0) {
                        ForEach(Mock.clients) { c in
                            NavigationLink { ClientDetailView() } label: {
                                HStack(spacing: 12) {
                                    Avatar(initials: c.initials, size: 34)
                                    VStack(alignment: .leading, spacing: 2) {
                                        Text(c.name).font(.subheadline.weight(.semibold))
                                        Text(c.detail).font(.caption2).foregroundStyle(JK.tertiary)
                                    }
                                    Spacer()
                                    Image(systemName: "chevron.right").font(.caption).foregroundStyle(JK.tertiary)
                                }
                                .foregroundStyle(JK.text)
                                .padding(12)
                            }
                        }
                    }
                    .jkCard(padding: 2)
                }
                .padding(16)
            }
            .jkScreen()
            .toolbar(.hidden, for: .navigationBar)
        }
    }
}

struct ClientDetailView: View {
    enum Tab: String, CaseIterable { case plan = "Plan", sessions = "Sessions", notes = "Notes", billing = "Billing" }
    @State private var tab: Tab = .plan

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                HStack(spacing: 12) {
                    Avatar(initials: "SC", size: 48)
                    VStack(alignment: .leading, spacing: 2) {
                        Text("Sam Carter").font(.title2.weight(.semibold)).foregroundStyle(JK.text)
                        Text("Elite · since Mar 2026").font(.caption).foregroundStyle(JK.tertiary)
                    }
                }
                HStack(spacing: 6) {
                    ForEach(["Paid · renews 1 Dec", "Adherence 86%", "Knee: monitor"], id: \.self) { t in
                        Text(t)
                            .font(.system(size: 10, weight: .medium))
                            .padding(.horizontal, 8).padding(.vertical, 4)
                            .overlay(Capsule().stroke(JK.stroke, lineWidth: 1))
                            .foregroundStyle(JK.secondary)
                    }
                }
                Segmented(options: Tab.allCases, selection: $tab) { $0.rawValue }

                if tab == .plan {
                    VStack(alignment: .leading, spacing: 2) {
                        Text("Fri · Lower Body Strength").font(.subheadline.weight(.semibold)).foregroundStyle(JK.text)
                        Text("Last edit by Sam · 09:31 (logged sets 1–2)").font(.caption2).foregroundStyle(JK.tertiary)
                    }
                    VStack(spacing: 0) {
                        ForEach(Mock.clientPlan) { row in
                            HStack {
                                VStack(alignment: .leading, spacing: 1) {
                                    Text(row.name).font(.subheadline.weight(.medium))
                                    Text(row.prescription).font(.caption2).foregroundStyle(JK.tertiary)
                                }
                                Spacer()
                                if let badge = row.badge {
                                    Text(badge)
                                        .font(.system(size: 9, weight: .semibold))
                                        .padding(.horizontal, 6).padding(.vertical, 2)
                                        .background(badge == "New" ? AnyShapeStyle(JK.text) : AnyShapeStyle(JK.cardRaised), in: Capsule())
                                        .foregroundStyle(badge == "New" ? Color.black : JK.secondary)
                                }
                                Image(systemName: "pencil").font(.caption).foregroundStyle(JK.tertiary)
                            }
                            .foregroundStyle(JK.text)
                            .padding(12)
                        }
                    }
                    .jkCard(padding: 2)
                    Label("Add exercise or copy from template", systemImage: "plus")
                        .font(.caption)
                        .foregroundStyle(JK.secondary)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 12)
                        .overlay(RoundedRectangle(cornerRadius: 12).strokeBorder(JK.stroke, style: StrokeStyle(lineWidth: 1, dash: [4])))
                    Button("Publish changes to Sam") {}.buttonStyle(ChromeButtonStyle())
                } else {
                    Text("\(tab.rawValue) — not designed yet")
                        .font(.footnote)
                        .foregroundStyle(JK.tertiary)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 40)
                }
            }
            .padding(16)
        }
        .jkScreen()
        .navigationTitle("Clients")
        .navigationBarTitleDisplayMode(.inline)
    }
}

// MARK: - Programs

struct ProgramsView: View {
    enum Tab: String, CaseIterable { case programs = "Programs", autoflows = "Autoflows", forms = "Forms" }
    @State private var tab: Tab = .programs

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                ScreenHeader(eyebrow: "Templates & automation", title: "Programs") {
                    Button {} label: { Label("New", systemImage: "plus") }
                        .font(.caption.weight(.semibold))
                        .padding(.horizontal, 12).padding(.vertical, 7)
                        .background(JK.chrome, in: Capsule())
                        .foregroundStyle(.black)
                }
                Segmented(options: Tab.allCases, selection: $tab) { $0.rawValue }
                ForEach(Mock.programs) { p in
                    HStack(spacing: 12) {
                        RoundedRectangle(cornerRadius: 10).fill(JK.cardRaised).frame(width: 52, height: 52)
                            .overlay(Image(systemName: "chart.xyaxis.line").foregroundStyle(JK.tertiary))
                        VStack(alignment: .leading, spacing: 4) {
                            Text(p.name).font(.subheadline.weight(.semibold)).foregroundStyle(JK.text)
                            Text(p.detail).font(.caption2).foregroundStyle(JK.tertiary)
                            Text(p.audience)
                                .font(.system(size: 10, weight: .medium))
                                .padding(.horizontal, 7).padding(.vertical, 2)
                                .background(JK.cardRaised, in: Capsule())
                                .foregroundStyle(JK.secondary)
                        }
                        Spacer()
                        Image(systemName: "chevron.right").font(.caption).foregroundStyle(JK.tertiary)
                    }
                    .jkCard(padding: 12)
                }
                Eyebrow(text: "Autoflow · New client onboarding")
                VStack(alignment: .leading, spacing: 0) {
                    ForEach(Mock.onboarding) { step in
                        HStack(spacing: 12) {
                            Image(systemName: step.systemName)
                                .font(.caption)
                                .frame(width: 26, height: 26)
                                .overlay(Circle().stroke(JK.stroke, lineWidth: 1))
                            Text(step.when).font(.caption2).foregroundStyle(JK.tertiary).frame(width: 56, alignment: .leading)
                            Text(step.action).font(.caption.weight(.medium))
                        }
                        .foregroundStyle(JK.text)
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

// MARK: - Schedule (week grid)

struct ScheduleView: View {
    @State private var filter = "All · 18"
    private let filters = ["All · 18", "1:1", "Group", "Calls", "Assessments"]
    private let days = ["Mon 16", "Tue 17", "Wed 18", "Thu 19", "Fri 20", "Sat 21"]
    private let hours = Array(6...19)
    private let rowHeight: CGFloat = 34

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 12) {
                    ScreenHeader(eyebrow: "All clients", title: "Schedule") {
                        Button {} label: { Label("Book", systemImage: "plus") }
                            .font(.caption.weight(.semibold))
                            .padding(.horizontal, 12).padding(.vertical, 7)
                            .background(JK.chrome, in: Capsule())
                            .foregroundStyle(.black)
                    }
                    ScrollView(.horizontal, showsIndicators: false) {
                        HStack(spacing: 6) {
                            ForEach(filters, id: \.self) { f in Chip(label: f, selected: filter == f) { filter = f } }
                        }
                    }
                    grid
                }
                .padding(16)
            }
            .jkScreen()
            .toolbar(.hidden, for: .navigationBar)
        }
    }

    private var grid: some View {
        HStack(alignment: .top, spacing: 4) {
            VStack(spacing: 0) {
                Text(" ").font(.system(size: 9)).frame(height: 24)
                ForEach(hours, id: \.self) { h in
                    Text("\(h)").font(.system(size: 9)).foregroundStyle(JK.tertiary).frame(height: rowHeight, alignment: .top)
                }
            }
            .frame(width: 18)
            ForEach(Array(days.enumerated()), id: \.offset) { index, day in
                VStack(spacing: 0) {
                    Text(day)
                        .font(.system(size: 9, weight: index == 4 ? .bold : .regular))
                        .foregroundStyle(index == 4 ? Color.black : JK.tertiary)
                        .frame(maxWidth: .infinity)
                        .frame(height: 20)
                        .background(index == 4 ? AnyShapeStyle(JK.chrome) : AnyShapeStyle(Color.clear), in: RoundedRectangle(cornerRadius: 5))
                        .padding(.bottom, 4)
                    ZStack(alignment: .top) {
                        VStack(spacing: 0) {
                            ForEach(hours, id: \.self) { _ in
                                Rectangle().fill(JK.stroke).frame(height: 1).frame(height: rowHeight, alignment: .top)
                            }
                        }
                        ForEach(Mock.scheduleBlocks.filter { $0.day == index }) { block in
                            Text(block.label)
                                .font(.system(size: 8, weight: .semibold))
                                .foregroundStyle(JK.text)
                                .frame(maxWidth: .infinity, alignment: .topLeading)
                                .padding(3)
                                .frame(height: rowHeight * block.length - 2, alignment: .top)
                                .background(JK.cardRaised, in: RoundedRectangle(cornerRadius: 4))
                                .overlay(RoundedRectangle(cornerRadius: 4).stroke(JK.stroke, lineWidth: 1))
                                .offset(y: rowHeight * (block.start - CGFloat(hours[0])))
                        }
                    }
                    .frame(height: rowHeight * CGFloat(hours.count), alignment: .top)
                }
            }
        }
    }
}

// MARK: - Hints & guides (coach tab root)

struct GuidesView: View {
    @AppStorage("jk.role") private var role: AppRole = .coach
    @State private var query = ""
    @State private var filter = "All"

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 14) {
                    ScreenHeader(eyebrow: "Coach library", title: "Hints & guides")
                    HStack {
                        Image(systemName: "magnifyingglass").foregroundStyle(JK.tertiary)
                        TextField("Search guides, cues, templates", text: $query)
                    }
                    .jkCard(padding: 10)
                    HStack(spacing: 6) {
                        ForEach(["All", "Programming", "Retention", "Business"], id: \.self) { f in
                            Chip(label: f, selected: filter == f) { filter = f }
                        }
                    }
                    VStack(alignment: .leading, spacing: 0) {
                        ZStack(alignment: .topTrailing) {
                            Rectangle().fill(JK.cardRaised).frame(height: 110)
                            Text("Video + PDF")
                                .font(.system(size: 9, weight: .semibold))
                                .padding(.horizontal, 7).padding(.vertical, 3)
                                .background(JK.card, in: Capsule())
                                .foregroundStyle(JK.secondary)
                                .padding(8)
                        }
                        VStack(alignment: .leading, spacing: 6) {
                            Eyebrow(text: "Featured guide · 8 min")
                            Text("Running a 12-week block without losing clients at week 6")
                                .font(.headline).foregroundStyle(JK.text)
                            Text("Deload timing, re-testing, and the check-in script that keeps adherence above 80%.")
                                .font(.caption).foregroundStyle(JK.tertiary)
                        }
                        .padding(14)
                    }
                    .background(JK.card)
                    .clipShape(RoundedRectangle(cornerRadius: JK.corner, style: .continuous))
                    .overlay(RoundedRectangle(cornerRadius: JK.corner, style: .continuous).stroke(JK.stroke, lineWidth: 1))

                    Eyebrow(text: "Quick tips")
                    ForEach(Mock.tips) { tip in
                        HStack(alignment: .top, spacing: 12) {
                            IconTile(systemName: tip.systemName, size: 32)
                            VStack(alignment: .leading, spacing: 2) {
                                Text(tip.title).font(.subheadline.weight(.semibold)).foregroundStyle(JK.text)
                                Text(tip.body).font(.caption2).foregroundStyle(JK.tertiary)
                            }
                        }
                        .jkCard(padding: 12)
                    }
                    Button("Sign out") { role = .signedOut }
                        .buttonStyle(GhostButtonStyle())
                        .padding(.top, 20)
                }
                .padding(16)
            }
            .jkScreen()
            .toolbar(.hidden, for: .navigationBar)
        }
    }
}

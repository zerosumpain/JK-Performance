import SwiftUI

/// Placeholder home screen until the JK Performance Coach designs are ported.
struct ContentView: View {
    var body: some View {
        NavigationStack {
            VStack(spacing: 12) {
                Image(systemName: "figure.run")
                    .font(.system(size: 48))
                Text("JK Performance")
                    .font(.title.bold())
            }
            .navigationTitle("Home")
            .navigationBarTitleDisplayMode(.inline)
        }
    }
}

#Preview { ContentView() }

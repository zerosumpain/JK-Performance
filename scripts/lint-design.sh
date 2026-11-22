#!/usr/bin/env bash
# Design-system lint (docs/design/atelier-spec.md, Components > GOVERNANCE).
# Literal sizes, radii and colours belong in the design layer only; screen
# files read tokens. Fails (exit 1) listing every offending line.
#
#   scripts/lint-design.sh            # every platform present in the checkout
#   scripts/lint-design.sh android    # one platform (android, ios, desk)
#
# Each platform is one lint_<platform> function, so platforms can be added
# independently. Plain grep -E, no dependencies.
set -uo pipefail
root=$(cd "$(dirname "$0")/.." && pwd)
failures=0

# rule <description> <regex> <files…>: report every matching line.
rule() {
  local what=$1 pattern=$2; shift 2
  [ $# -eq 0 ] && return 0
  local hits
  hits=$(grep -nE -- "$pattern" "$@" 2>/dev/null || true)
  if [ -n "$hits" ]; then
    echo "lint-design: $what"
    echo "$hits" | sed "s|^$root/|  |"
    failures=$((failures + $(echo "$hits" | wc -l)))
  fi
}

lint_android() {
  local app="$root/android/app/src/main/java/com/jkperformance/app"
  [ -d "$app" ] || return 0
  local screens=() all=()
  while IFS= read -r f; do screens+=("$f"); done < <(find "$app/client" "$app/coach" -name '*.kt' | sort)
  while IFS= read -r f; do all+=("$f"); done < <(find "$app" -name '*.kt' -not -path "$app/design/*" | sort)

  rule "literal text size (use a JKType token)" '[0-9]\.sp\b|fontSize *= *[0-9]' "${all[@]}"
  rule "literal corner radius (use JKShape / JKRadius)" 'RoundedCornerShape\( *[0-9.]+\.dp|rounded\( *[0-9.]+\.dp|cornerRadius *= *[0-9]' "${all[@]}"
  rule "literal colour (use JKColors)" 'Color\(0x|Color\( *[0-9.]+f? *,|Color\.(Black|White)\b' "${all[@]}"
  rule "fixed height on a text-bearing control (use heightIn(min = …))" '\.height\( *[0-9.]+\.dp\).*(Text\(|Button|TextField|Field\()|(Text\(|Button|TextField|Field\().*\.height\( *[0-9.]+\.dp\)' "${screens[@]}"
  rule "textTertiary on raised (4.4:1, never on raised)" 'JKColors\.raised.*JKColors\.textTertiary|JKColors\.textTertiary.*JKColors\.raised' "${screens[@]}"
  rule "Material icon sets (use IconKey / Glyph)" 'androidx\.compose\.material\.icons|Icons\.(Outlined|Filled|Rounded|AutoMirrored|Default|Sharp|TwoTone)\.' "${all[@]}"
  rule "retired chrome or tile (Atelier)" '\bJK\.chrome\b|ChromeButton\(|GhostButton\(|IconTile\(|sfIcon\(' "${all[@]}"
  rule "gradient (no gradients outside BrandIntro)" 'Brush\.(linear|radial|vertical|horizontal|sweep)Gradient' "${all[@]}"
}

platforms=("$@")
[ ${#platforms[@]} -eq 0 ] && platforms=(android ios desk)
for p in "${platforms[@]}"; do
  if declare -F "lint_$p" >/dev/null; then "lint_$p"; fi
done

if [ "$failures" -gt 0 ]; then
  echo "lint-design: $failures problem(s)"
  exit 1
fi
echo "lint-design: clean (${platforms[*]})"

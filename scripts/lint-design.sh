#!/usr/bin/env bash
# Design-token lint (docs/design/atelier-spec.md, "GOVERNANCE"; palette from
# docs/design/plan-act-review.md, "Look"): screen files
# use tokens and components, never literal colours, font sizes, radii or fixed
# heights on text. Literal values belong in the design layer only:
#   iOS     ios/JKPerformance/Design/   (Tokens.swift, Type.swift, Components/)
#   Android android/app/src/main/java/**/design/
#   Desk    the :root token blocks of server/desk/*.css
#
# Usage: scripts/lint-design.sh [ios|android|desk]...   (default: all three)
#
# Exceptions, both meant to be temporary and visible in review:
#   - a trailing comment `lint-design: allow <reason>` on the offending line;
#   - scripts/lint-design-allow.txt: lines of `<path glob>|<extended regex>`;
#     a finding in a matching file whose text matches the regex is skipped.
set -euo pipefail
cd "$(dirname "$0")/.."

ALLOW_FILE=scripts/lint-design-allow.txt
failures=0

allowed() { # <file> <line text>
  local file=$1 text=$2 glob regex
  [[ $text == *"lint-design: allow"* ]] && return 0
  [[ -f $ALLOW_FILE ]] || return 1
  while IFS='|' read -r glob regex; do
    [[ -z $glob || $glob == \#* ]] && continue
    # shellcheck disable=SC2053
    if [[ $file == $glob ]] && grep -Eq -- "$regex" <<<"$text"; then return 0; fi
  done <"$ALLOW_FILE"
  return 1
}

# check <label> <extended regex> <files...>
check() {
  local label=$1 regex=$2
  shift 2
  [[ $# -gt 0 ]] || return 0
  local hit file line text
  while IFS= read -r hit; do
    file=${hit%%:*}
    line=${hit#*:}; line=${line%%:*}
    text=${hit#*:*:}
    allowed "$file" "$text" && continue
    printf '%s:%s: %s\n    %s\n' "$file" "$line" "$label" "$(sed -E 's/^[[:space:]]+//' <<<"$text")"
    failures=$((failures + 1))
  done < <(grep -HnE -- "$regex" "$@" || true)
}

lint_ios() {
  local screens=()
  while IFS= read -r f; do screens+=("$f"); done < <(
    find ios/JKPerformance/Client ios/JKPerformance/Coach -name '*.swift' 2>/dev/null
    ls ios/JKPerformance/JKPerformanceApp.swift 2>/dev/null)
  [[ ${#screens[@]} -gt 0 ]] || return 0
  check "literal font size: use a Font.jk* token (Design/Type.swift)" '\.system\(size:' "${screens[@]}"
  check "custom font outside Design/Type.swift" 'Font\.custom|\.custom\("' "${screens[@]}"
  check "literal corner radius: use JK.Radius" 'cornerRadius: *[0-9]' "${screens[@]}"
  check "literal colour: use a JK colour token" \
    'Color\.(black|white|red|green|blue|orange|yellow|pink|purple|gray|grey)\b|Color\((white|red):|UIColor\.(black|white|red|green|systemRed|systemGreen)\b' "${screens[@]}"
  check "system bright colour: use a JK colour token" \
    '\.(foregroundStyle|foregroundColor|tint|fill|stroke|background)\(\.(black|white|red|green|blue|orange|yellow|pink|purple|gray)\)' "${screens[@]}"
  check "gradient or shadow: Atelier has none" '(Linear|Radial|Angular)Gradient\(|\.shadow\(' "${screens[@]}"
  check "fixed height on text: use frame(minHeight:)" \
    '(Text\(|Button[ ({]|TextField\().*\.frame\((width: [^,]+, )?height:' "${screens[@]}"
  # textTertiary measures 4.4:1 on raised: never pair them, in screens or the design layer.
  local all=()
  while IFS= read -r f; do all+=("$f"); done < <(find ios/JKPerformance -name '*.swift')
  check "textTertiary on raised (4.4:1): use textSecondary" 'JK\.textTertiary.*JK\.raised|JK\.raised.*JK\.textTertiary' "${all[@]}"
}

lint_android() {
  local app=android/app/src/main/java/com/jkperformance/app
  [[ -d $app ]] || return 0
  local screens=() all=()
  while IFS= read -r f; do screens+=("$f"); done < <(find "$app/client" "$app/coach" -name '*.kt' 2>/dev/null | sort)
  while IFS= read -r f; do all+=("$f"); done < <(find "$app" -name '*.kt' -not -path "$app/design/*" | sort)
  check "literal font size: use a JKType token (design/Type.kt)" '[0-9]\.sp\b|fontSize *= *[0-9]' "${all[@]}"
  check "literal corner radius: use JKShape / JKRadius" \
    'RoundedCornerShape\( *[0-9.]+\.dp|rounded\( *[0-9.]+\.dp|cornerRadius *= *[0-9]' "${all[@]}"
  check "literal colour: use JKColors" 'Color\(0x|Color\( *[0-9.]+f? *,|Color\.(Black|White|Red|Green|Blue|Yellow)\b' "${all[@]}"
  check "fixed height on text: use heightIn(min = ...)" \
    '\.height\( *[0-9.]+\.dp\).*(Text\(|Button|TextField|Field\()|(Text\(|Button|TextField|Field\().*\.height\( *[0-9.]+\.dp\)' "${screens[@]}"
  check "textTertiary on raised (4.4:1): use textSecondary" \
    'JKColors\.raised.*JKColors\.textTertiary|JKColors\.textTertiary.*JKColors\.raised' "${all[@]}"
  check "Material icon sets: use IconKey / Glyph" \
    'androidx\.compose\.material\.icons|Icons\.(Outlined|Filled|Rounded|AutoMirrored|Default|Sharp|TwoTone)\.' "${all[@]}"
  check "retired chrome or tile (Atelier)" '\bJK\.chrome\b|ChromeButton\(|GhostButton\(|IconTile\(|sfIcon\(' "${all[@]}"
  check "gradient or shadow: only the chrome PrimaryButton (design layer) has one" \
    'Brush\.(linear|radial|vertical|horizontal|sweep)Gradient|\.shadow\(' "${screens[@]}"
  # Plan. Act. Review.: client screens are monochrome silver. Status and booking-kind colours are coach-only.
  local client=()
  while IFS= read -r f; do client+=("$f"); done < <(find "$app/client" -name '*.kt' 2>/dev/null | sort)
  check "colour on a client screen: the client app is monochrome (plan-act-review.md, Look)" \
    'JKColors\.(onTrack|attention|data|error|urgent|inPerson|video|group|accentWash)\b|JKColors\.slot\(' "${client[@]}"
  local design=()
  while IFS= read -r f; do design+=("$f"); done < <(find "$app/design" -name '*.kt' | sort)
  check "retired champagne: the palette is silver (design/Tokens.kt)" '(C8A970|B08F52)' "${all[@]}" "${design[@]}"
}

lint_desk() {
  local css=()
  while IFS= read -r f; do css+=("$f"); done < <(find server/desk -maxdepth 1 -name '*.css' 2>/dev/null)
  [[ ${#css[@]} -gt 0 ]] || return 0
  local file hit
  for file in "${css[@]}"; do
    # Hex colours outside :root / [data-theme] blocks (the token definitions).
    while IFS= read -r hit; do
      local line=${hit%%:*} text=${hit#*:}
      allowed "$file" "$text" && continue
      printf '%s:%s: %s\n    %s\n' "$file" "$line" "hex colour outside the token block: use var(--token)" \
        "$(sed -E 's/^[[:space:]]+//' <<<"$text")"
      failures=$((failures + 1))
    done < <(awk '
      {
        text = $0; opens = gsub(/[{]/, "{", text); closes = gsub(/[}]/, "}", text)
        if (!intoken && opens > 0 && $0 ~ /:root|\[data-theme/) { intoken = 1; tokdepth = depth }
        decl = $0; if (opens > 0) decl = substr($0, index($0, "{") + 1)
        if (!intoken && $0 !~ /^[ \t]*(\/\*|\*)/ && decl ~ /:[^;]*#[0-9a-fA-F][0-9a-fA-F][0-9a-fA-F]/) print NR ":" $0
        depth += opens - closes
        if (intoken && depth <= tokdepth) intoken = 0
      }
    ' "$file")
  done
}

targets=("$@")
[[ ${#targets[@]} -gt 0 ]] || targets=(ios android desk)
for t in "${targets[@]}"; do
  case $t in
    ios) lint_ios ;;
    android) lint_android ;;
    desk) lint_desk ;;
    *) echo "unknown target: $t (ios, android, desk)" >&2; exit 2 ;;
  esac
done

if [[ $failures -gt 0 ]]; then
  echo "lint-design: $failures finding(s) in ${targets[*]}. Use the tokens and components in the design layer." >&2
  exit 1
fi
echo "lint-design: clean (${targets[*]})"

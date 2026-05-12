#!/usr/bin/env sh
set -eu

OUT="${1:-docs/assets/demo.gif}"
mkdir -p "$(dirname "$OUT")"

ffmpeg -y \
  -f lavfi -i color=c=0x111827:s=960x540:d=30:r=10 \
  -vf "drawtext=fontcolor=white:fontsize=28:x=50:y=50:text='dispatch-detector < bad.patch',
drawtext=fontcolor=0xff6b6b:fontsize=24:x=50:y=130:enable='between(t,3,30)':text='FAIL  score 50',
drawtext=fontcolor=0xffd166:fontsize=22:x=50:y=190:enable='between(t,6,30)':text='line 1  mode 1  TODO marker introduced',
drawtext=fontcolor=0xffd166:fontsize=22:x=50:y=230:enable='between(t,9,30)':text='line 2  mode 1  Placeholder return introduced',
drawtext=fontcolor=0x7dd3fc:fontsize=22:x=50:y=330:enable='between(t,14,30)':text='CI exit code 2',
drawtext=fontcolor=0xa7f3d0:fontsize=22:x=50:y=380:enable='between(t,18,30)':text='Deterministic checks fail fast before LLM judge',
drawtext=fontcolor=0xd1d5db:fontsize=18:x=50:y=480:enable='between(t,24,30)':text='dispatch.ai catches AI placeholder diffs before PR review'" \
  -loop 0 "$OUT"

#!/usr/bin/env bash
# Re-encode the Remotion renders for the repository.
#
#   bash scripts/encode-media.sh prepare   # recording webm -> seek-friendly mp4 for Remotion
#   bash scripts/encode-media.sh final     # out/*.raw.mp4 -> out/*.mp4 (CRF tuned)
#
# The README hero is no longer cut from the film (its zoom-to-focus camera
# cropped text and carried the cursor overlay and caption bar). It is a plain
# capture of the running app: scripts/design/capture-readme.mjs and
# scripts/design/readme-media.py at the repository root.
#
# Uses the system ffmpeg when present, else Remotion's bundled ffmpeg.
set -euo pipefail
cd "$(dirname "$0")/.."

FFMPEG="${FFMPEG:-$(command -v ffmpeg || true)}"
if [ -z "$FFMPEG" ]; then
  FFMPEG="$(ls node_modules/@remotion/compositor-linux-x64-gnu/ffmpeg 2>/dev/null || true)"
fi
[ -n "$FFMPEG" ] || { echo "no ffmpeg found" >&2; exit 1; }


case "${1:-}" in
  prepare)
    # Intra-heavy H.264 (keyframe every 10 frames) so OffthreadVideo seeks fast; near-lossless.
    "$FFMPEG" -v error -y -i public/recording/walkthrough.webm -c:v libx264 -preset medium -crf 12 \
      -g 10 -pix_fmt yuv420p -movflags +faststart -an public/recording/walkthrough.mp4
    # The live patient video chapter: two spans of the real live capture
    # (docs/media/live-avatar, MuseTalk on the GPU worker), silent, seek-friendly.
    # call-page: the transcript and call tile of the encounter page while the patient answers
    # (cropped below the banner, which in that capture shows its own case source); call-face: the stream.
    "$FFMPEG" -v error -y -ss 78 -t 8.5 -i ../docs/media/live-avatar/encounter-page.mp4 -vf "crop=570:474:390:125,setpts=PTS-STARTPTS" -c:v libx264 -preset medium -crf 14 \
      -g 10 -r 30 -pix_fmt yuv420p -movflags +faststart -an public/recording/call-page.mp4
    "$FFMPEG" -v error -y -ss 9.5 -t 9 -i ../docs/media/live-avatar/patient-live.mp4 -c:v libx264 -preset medium -crf 14 \
      -g 10 -r 30 -pix_fmt yuv420p -movflags +faststart -an public/recording/call-face.mp4
    ls -la public/recording/*.mp4
    ;;
  final)
    # Screen content. A light temporal denoise removes the VP8 shimmer of the
    # source recording (most of the bitrate), adaptive quantisation keeps flat
    # UI ground cheap; CRF chosen so all committed media stays under 30 MB.
    for pair in "walkthrough:32" "teaser-v2:30" "square:31"; do
      name="${pair%%:*}"; crf="${pair##*:}"
      "$FFMPEG" -v error -y -i "out/$name.raw.mp4" -vf "hqdn3d=2:2:6:6" -c:v libx264 -preset slower -crf "$crf" \
        -x264-params "aq-mode=3:psy-rd=0.6" -pix_fmt yuv420p -movflags +faststart -an "out/$name.mp4"
    done
    ls -la out/*.mp4
    ;;
  *)
    echo "usage: $0 prepare|final" >&2
    exit 2
    ;;
esac

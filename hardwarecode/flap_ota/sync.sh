#!/bin/sh
# Copy the master flap_ota.h into every sketch folder that uses it.
cd "$(dirname "$0")/.." || exit 1
for d in $(grep -rl --include='*.ino' 'flap_ota.h' . | xargs -n1 dirname | sort -u); do
  cp flap_ota/flap_ota.h "$d/flap_ota.h" && echo "updated $d/flap_ota.h"
done

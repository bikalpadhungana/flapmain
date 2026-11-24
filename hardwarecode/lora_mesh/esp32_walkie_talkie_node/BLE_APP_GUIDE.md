# Connecting an app to the ESP32 walkie-talkie over Bluetooth LE

The ESP32 walkie (`esp32_walkie_talkie_node`) exposes a Bluetooth LE serial link. A phone
connects to it, sends text commands, and receives text lines: the same protocol the
flaap.me Hardware page and the mobile app already use over USB serial. The walkie
carries the messages over LoRa to other walkies, AWS stations and gateways.

```
flaap.me app ──BLE──> ESP32 walkie ──LoRa──> other walkies / gateway ──> dashboard
```

## 1. Find and connect

| Item | Value |
|---|---|
| Advertised name | `FlapWalkie-<node id>`, e.g. `FlapWalkie-104` |
| Service (Nordic UART) | `6e400001-b5a3-f393-e0a9-e50e24dcca9e` |
| RX: app writes commands | `6e400002-b5a3-f393-e0a9-e50e24dcca9e` (write, write without response) |
| TX: walkie sends lines | `6e400003-b5a3-f393-e0a9-e50e24dcca9e` (notify) |
| MTU | request 185 (walkie supports up to 185) |

Connection steps:

1. Scan for the service UUID, or names starting with `FlapWalkie-`.
2. Connect, request MTU 185, discover services.
3. Enable notifications on TX (write `0x0001` to its CCCD `0x2902`).
4. Write commands to RX.
5. Wait for the line `READY node=<id>` before treating the walkie as ready. It is sent
   once the link is paired and encrypted (see below). Nothing else arrives before it.

Only one phone can be connected at a time. When it disconnects, the walkie advertises again.

## 2. Pairing

The default mode is "Just Works" (`BLE_PAIRING 1` in `config.h`):

- **No PIN.** Android shows a "Pair with FlapWalkie-104?" dialog; the user taps **Pair**.
  The link is still encrypted.
- **The first phone can pair at any time.** Once a phone is paired, a *new* phone can pair
  only while the pairing window is open:
  - for the first 2 minutes after the walkie is switched on, or
  - for 2 minutes after the user **holds SELECT for 3 seconds** (the walkie beeps twice and
    shows "BT PAIRING OPEN").

  Outside the window a new phone is refused; the walkie shows "PAIRING LOCKED" and disconnects.
- **Already-paired phones reconnect at any time**, with no dialog.
- **Who starts pairing:** the app's first write (`PING`) needs an encrypted link, so Android
  starts pairing by itself and shows the dialog. If the link is still not secure 3 s after
  connecting, the walkie asks the phone to pair.
- If pairing fails, the walkie forgets its half of the pairing (so the next try starts fresh)
  and prints the reason on its USB serial, e.g. `reason 0x63: the phone did not answer`.

Commands typed on the walkie's USB serial (they also work over Bluetooth):

| Command | Effect |
|---|---|
| `/pair` | open the pairing window |
| `/unpair` | forget all paired phones |
| `/ble` | Bluetooth and radio state, for troubleshooting |
| `/debug on` / `/debug off` | also send the human-readable debug log over Bluetooth (off by default) |

Other modes, chosen at build time in `config.h`:

| `BLE_PAIRING` | Behaviour |
|---|---|
| `2` | The walkie shows a 6-digit code on its OLED; the phone asks for it. Most secure; needs the display. |
| `0` | Open link with no pairing. Bench testing only: anyone nearby can send through the radio. |

What the app should do about pairing:

- Nothing special on Android: the system handles the dialog.
- If no `READY` arrives within about 20 s of connecting, show: "Tap **Pair** on the
  Bluetooth prompt. If it doesn't appear, hold SELECT on the walkie for 3 seconds and connect again."
- If the walkie was re-flashed with a different pairing mode, the old pairing no longer
  matches. Tell the user to remove *FlapWalkie-…* under Settings → Bluetooth, then pair again.

## 3. Framing

- UTF-8 text, one command per line. End each line with `\r\n` (or `\n`). A write without a
  line ending also counts as a full line after 300 ms of silence.
- Commands are at most 95 bytes. Message text is at most **31 bytes**: the radio packet
  limit. That is 31 English characters but only about 10 Nepali ones (3 bytes each). The
  walkie cuts longer text at a character boundary; the app should count bytes
  (`new TextEncoder().encode(text).length`), not characters.
- The walkie sends complete lines ending in `\n`. A long line may arrive split across
  several notifications, so buffer incoming text and split on `\n`. A notification never
  ends inside a multi-byte character.

## 4. Commands and replies

### App → walkie

| Command | Meaning | Reply |
|---|---|---|
| `PING` | hello / check the link | `PONG`, then `READY node=<id>` |
| `LORA:MSG <text>` | send a text message (to everyone, or the walkie's selected target) | `OK:MSG` |
| `LORA:LOC <lat>,<lon>,<acc_m>` | share the phone's location | `OK:LOC <lat>,<lon>,<acc>` |
| `LORA:SOS <TYPE> [<lat>,<lon>,<acc_m>]` | start an emergency SOS | `OK:SOS-SENT <TYPE>` |
| `LORA:SOS CANCEL` | stop the SOS | `OK:SOS-CANCEL` |
| `/status` | one-line status | `STATUS node=… batt=… unread=… inbox=… target=… last=… last_to=… ble=1 lora=1` (`lora=0`: radio module not detected) |
| `<text> /<node>` | send directly to one radio, e.g. `Meet at gate /102` | delivery result (below) |

- **SOS types:** `GENERAL`, `MEDICAL`, `FIRE`, `ACCIDENT`, `LOST`, `SECURITY`. An unknown
  type becomes `GENERAL`.
- **SOS repeats:** the walkie re-broadcasts an active SOS every 30 s, and stops after
  10 minutes or on `LORA:SOS CANCEL`. When it stops by itself it sends
  `OK:SOS stopped after 10 minutes`.

### Walkie → app

| Line | Meaning |
|---|---|
| `READY node=<id>` | link usable; `<id>` is this walkie's node number |
| `PONG` | answer to `PING` |
| `RX:MSG node=<n> rssi=<dBm> <text>` | text message received over LoRa (`node=0` is the dashboard / gateway) |
| `RX:LOC node=<n> rssi=<dBm> <lat>,<lon>,<acc>` | another radio shared its location |
| `RX:SOS node=<n> rssi=<dBm> <TYPE> [<lat>,<lon>,<acc>]` | emergency SOS heard; alert the user |
| `RX:SOS-CANCEL node=<n> rssi=<dBm>` | that radio cancelled its SOS |
| `OK:<detail>` | command accepted, or a delivery confirmation: `OK:Delivered to node 102`, `OK:Reached BASE` |
| `ERR:<reason>` | command refused, or `ERR:Not delivered to node 102 (no reply)` |

Ignore any other line. The walkie's debug log stays on USB unless `/debug on` is sent.
If the radio module is missing, sends reply `ERR:LoRa radio not detected (check SX1278 wiring and power)`.

### Delivery results

- **Direct messages** (`text /102`): the receiving walkie confirms. The walkie re-sends up to
  twice, about 6 s apart, then reports `OK:Delivered to node 102` or
  `ERR:Not delivered to node 102 (no reply)`.
- **Messages to everyone and SOS:** walkies don't confirm. When a gateway hears it, the
  app gets `OK:Reached BASE`.

## 5. Example session

```
app    → (connects over Bluetooth)
app    → PING                (refused until paired; Android shows "Pair with FlapWalkie-104?", user taps Pair)
walkie ← READY node=104      (sent as soon as pairing completes)
app    → PING
walkie ← PONG
walkie ← READY node=104
app    → /status
walkie ← STATUS node=104 batt=3950 unread=0 inbox=0 target=0 last=none last_to=0 ble=1 lora=1
app    → LORA:MSG Water at camp 2
walkie ← OK:MSG
walkie ← OK:Reached BASE
walkie ← RX:MSG node=102 rssi=-84 Copy, on our way
app    → LORA:SOS MEDICAL 27.71720,85.32400,12
walkie ← OK:SOS-SENT MEDICAL
app    → LORA:SOS CANCEL
walkie ← OK:SOS-CANCEL
```

## 6. In the flaap.me mobile app

**Android** already works with this protocol through `modules/flap-mesh` (`FlapSerialModule.kt`):

- `Serial.scanBle()` finds the walkie. Its name matches the app's "flap" device filter.
- `Serial.connect(address, 'ble')` picks the Nordic UART service, requests MTU 185 and
  enables notifications.
- `hardwareService.js` sends `PING` / `LORA:*` and parses `READY`, `OK:`, `ERR:` and `RX:` lines.

The app's current working copy also handles pairing and delivery (not yet committed in the
app repo, so older installed builds don't have it):

- A "pairing" state between Bluetooth connected and `READY`; `PING` every 3 s until
  `READY` or `PONG`; a pairing hint after 20 s.
- `onBond` events: re-`PING` when pairing completes, and an error if pairing is refused.
- `onWriteError`: writes refused because the phone isn't paired (status 5 / 15 / 137) are
  expected while the pairing dialog is open, and reported after that.
- `/status` every 60 s; delivery state on sent messages from `OK:Delivered…`,
  `OK:Reached BASE` and `ERR:Not delivered…`.

Still to do in the app:

1. **Limit messages by bytes, not characters** (section 3). `MAX_LORA_TEXT = 31` counts
   characters, so a Nepali message is cut by the walkie after about 10 letters.
2. **iOS** (below).

**iOS:** `ios/FlapSerialModule.swift` is still a stub. An implementation with CoreBluetooth
follows the same steps:

1. `CBCentralManager.scanForPeripherals(withServices: [6E400001…])`, then connect.
2. `discoverServices` / `discoverCharacteristics`.
3. `setNotifyValue(true, for: TX)`, then write to RX with `.withResponse`.

iOS shows its own pairing dialog when the walkie requests encryption. There is no MTU
call on iOS (it negotiates automatically); use
`maximumWriteValueLength(for: .withResponse)` to size writes.

## 7. Web Bluetooth (Chrome on Android / desktop)

Useful for testing, or for a web version of the app. Not supported in Safari or on iPhone.

```js
const NUS = '6e400001-b5a3-f393-e0a9-e50e24dcca9e';
const RX  = '6e400002-b5a3-f393-e0a9-e50e24dcca9e';
const TX  = '6e400003-b5a3-f393-e0a9-e50e24dcca9e';

const device = await navigator.bluetooth.requestDevice({
  filters: [{ namePrefix: 'FlapWalkie-' }], optionalServices: [NUS],
});
const server = await device.gatt.connect();
const svc = await server.getPrimaryService(NUS);
const rx = await svc.getCharacteristic(RX);
const tx = await svc.getCharacteristic(TX);

let buf = '';
tx.addEventListener('characteristicvaluechanged', (e) => {
  buf += new TextDecoder().decode(e.target.value);
  const lines = buf.split('\n'); buf = lines.pop();
  lines.forEach((l) => console.log('walkie:', l.trim()));
});
await tx.startNotifications();

const send = (line) => rx.writeValue(new TextEncoder().encode(line + '\r\n'));
await send('PING');
await send('LORA:MSG Hello from the web');
```

Web Bluetooth UUIDs must be lowercase.

## 8. Test checklist

- [ ] First phone pairs: Pair dialog, then `READY node=104` and "Walkie ready" in the app.
- [ ] With one phone paired, a second phone more than 2 minutes after power-on is refused
      ("PAIRING LOCKED"); holding SELECT 3 s lets it pair.
- [ ] A Nepali message arrives intact (cut cleanly at about 10 letters if longer).
- [ ] A paired phone reconnects later without a dialog.
- [ ] `LORA:MSG` reaches another walkie, and the dashboard shows it via the gateway.
- [ ] A message from another walkie appears in the app as `RX:MSG`.
- [ ] `LORA:SOS MEDICAL …` alarms other walkies; `RX:SOS` on another phone opens the alert
      with a map link; `LORA:SOS CANCEL` stops it.
- [ ] `text /102` to a powered-off walkie ends in `ERR:Not delivered…` after about 18 s.

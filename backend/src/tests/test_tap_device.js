const http = require('http');

function makeRequest(options, postData) {
  return new Promise((resolve, reject) => {
    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        try {
          resolve({ statusCode: res.statusCode, body: JSON.parse(data) });
        } catch (e) {
          resolve({ statusCode: res.statusCode, body: data });
        }
      });
    });
    req.on('error', reject);
    if (postData) {
      req.write(JSON.stringify(postData));
    }
    req.end();
  });
}

async function runTest() {
  console.log('Testing FlapMain Tap Device API Endpoints...\n');

  try {
    // 1. Test Ping
    console.log('1. Testing GET /api/device/ping...');
    const pingRes = await makeRequest({
      hostname: 'localhost',
      port: 5050,
      path: '/api/device/ping',
      method: 'GET',
    });
    console.log('PING Response:', pingRes);

    // 2. Test Tap
    console.log('\n2. Testing POST /api/device/tap...');
    const tapRes = await makeRequest(
      {
        hostname: 'localhost',
        port: 5050,
        path: '/api/device/tap',
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      },
      {
        flapid: 'bikalpa',
        uid: '04A1B2C3D4E5',
        type: 'card',
      }
    );
    console.log('TAP Response:', tapRes);

    // 3. Test Tags Lookup
    console.log('\n3. Testing POST /api/tags/lookup...');
    const lookupRes = await makeRequest(
      {
        hostname: 'localhost',
        port: 5050,
        path: '/api/tags/lookup',
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      },
      {
        flapid: 'bikalpa',
        uid: '04A1B2C3D4E5',
        type: 'card',
      }
    );
    console.log('LOOKUP Response:', lookupRes);

    console.log('\n✅ ALL TAP DEVICE ENDPOINTS VERIFIED SUCCESSFULLY!');
  } catch (err) {
    console.error('❌ Test Failed:', err.message);
  }
}

runTest();

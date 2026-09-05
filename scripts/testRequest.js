(async () => {
  try {
    const city = 'San Francisco';
    const res = await fetch('http://localhost:5000/api/dashboard-data', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ city })
    });
    const text = await res.text();
    try {
      const json = JSON.parse(text);
      console.log(JSON.stringify(json, null, 2));
    } catch (err) {
      console.log('Non-JSON response:\n', text);
    }
  } catch (err) {
    console.error('Request failed:', err.message || err);
  }
})();

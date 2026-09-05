(async () => {
  try {
    const res = await fetch('http://localhost:5000/api/profile');
    const json = await res.json();
    console.log(JSON.stringify(json, null, 2));
  } catch (err) {
    console.error('Request failed:', err.message || err);
  }
})();

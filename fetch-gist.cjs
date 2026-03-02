const https = require('https');
https.get('https://gist.githubusercontent.com/ceane/e381668bef97c0bc2acd6d065a4df5ac/raw', (res) => {
  let data = '';
  res.on('data', (chunk) => data += chunk);
  res.on('end', () => console.log(data));
});

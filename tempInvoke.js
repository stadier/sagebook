const token = 'eyJhbGciOiJFUzI1NiIsImtpZCI6ImY0NTRjNGMyLTI1ZGItNGU1Zi05NjgyLWJiM2Y2YjVhMjA2ZSIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJodHRwczovL3lqZGt6Ym1kbmVmeG5vdm10eHJ6LnN1cGFiYXNlLmNvL2F1dGgvdjEiLCJzdWIiOiJkZmY1NzY2Yy0xMjMzLTQ2ODktYWE4ZC03NWZlYzA3NDM0NjEiLCJhdWQiOiJhdXRoZW50aWNhdGVkIiwiZXhwIjoxNzgyODIyOTUwLCJpYXQiOjE3ODI4MTkzNTAsImVtYWlsIjoicnVzc0B0ZXN0LmNvbSIsInBob25lIjoiIiwiYXBwX21ldGFkYXRhIjp7InByb3ZpZGVyIjoiZW1haWwiLCJwcm92aWRlcnMiOlsiZW1haWwiXX0sInVzZXJfbWV0YWRhdGEiOnsiZW1haWxfdmVyaWZpZWQiOnRydWV9LCJyb2xlIjoiYXV0aGVudGljYXRlZCIsImFhbCI6ImFhbDEiLCJhbXIiOlt7Im1ldGhvZCI6InBhc3N3b3JkIiwidGltZXN0YW1wIjoxNzgyODE5MzUwfV0sInNlc3Npb25faWQiOiI1YjFhM2I2YS0zMTdiLTRjYjgtOTUyYy1hNmU1N2RkZWI5MmUiLCJpc19hbm9ueW1vdXMiOmZhbHNlfQ.CBfb8cKJaTjY31bw2j52VFPEK7VwJ4dRRnXnwn912dP9o91yTo5vhVORbNB7nM1wtOddtDtEXysBWTToKcGi8w';
const url = 'https://yjdkzbmdnefxnovmtxrz.supabase.co/functions/v1/process-media';
const body = {
  mediaKind: 'text',
  text: 'Whole Foods Market receipt. Date: 2026-06-29. Items: Organic Bananas $3.99, Greek Yogurt $5.49, Almond Butter $7.99, Wild Salmon $18.50. Subtotal: $36.97. Tax: $3.11. Total: $40.08.',
  promptHint: 'Grocery receipt in USD',
  baseCurrency: 'USD'
};
(async () => {
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const text = await res.text();
    console.log(JSON.stringify({ status: res.status, statusText: res.statusText, body: text }));
  } catch (err) {
    console.error('request failed', err);
  }
})();

async function testCsv() {
  const id = '1tsndbJWnXPvY3_LQhtzVNPRMJxqjan3ScQXSvIUKPg4';
  const sheets = ['USERS', 'WAREHOUSES', 'LOCATIONS', 'PRODUCTS'];
  for (const s of sheets) {
    const url = `https://docs.google.com/spreadsheets/d/${id}/gviz/tq?tqx=out:csv&sheet=${s}`;
    const text = await fetch(url).then(r => r.text());
    const lines = text.split(/\r?\n/).filter(Boolean);
    console.log(`=== ${s} === (Lines: ${lines.length})`);
    lines.forEach((l, i) => console.log(` Line ${i}:`, l));
  }
}

testCsv().catch(console.error);

export {};

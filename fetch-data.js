// fetch-data.js — Hospital Tension Dashboard (FR/US)
// Node 20+ (fetch natif). Lancé par GitHub Actions, écrit data.json à la racine.

const US_STATES = {
  AL:"Alabama",AK:"Alaska",AZ:"Arizona",AR:"Arkansas",CA:"California",CO:"Colorado",
  CT:"Connecticut",DE:"Delaware",FL:"Florida",GA:"Georgia",HI:"Hawaii",ID:"Idaho",
  IL:"Illinois",IN:"Indiana",IA:"Iowa",KS:"Kansas",KY:"Kentucky",LA:"Louisiana",
  ME:"Maine",MD:"Maryland",MA:"Massachusetts",MI:"Michigan",MN:"Minnesota",
  MS:"Mississippi",MO:"Missouri",MT:"Montana",NE:"Nebraska",NV:"Nevada",
  NH:"New Hampshire",NJ:"New Jersey",NM:"New Mexico",NY:"New York",NC:"North Carolina",
  ND:"North Dakota",OH:"Ohio",OK:"Oklahoma",OR:"Oregon",PA:"Pennsylvania",
  RI:"Rhode Island",SC:"South Carolina",SD:"South Dakota",TN:"Tennessee",TX:"Texas",
  UT:"Utah",VT:"Vermont",VA:"Virginia",WA:"Washington",WV:"West Virginia",
  WI:"Wisconsin",WY:"Wyoming",DC:"District of Columbia",USA:"National (agrégat US)"
};

const FR_REGIONS = {
  "11":"Île-de-France","24":"Centre-Val de Loire","27":"Bourgogne-Franche-Comté",
  "28":"Normandie","32":"Hauts-de-France","44":"Grand Est","52":"Pays de la Loire",
  "53":"Bretagne","75":"Nouvelle-Aquitaine","76":"Occitanie","84":"Auvergne-Rhône-Alpes",
  "93":"Provence-Alpes-Côte d'Azur","94":"Corse","01":"Guadeloupe","02":"Martinique",
  "03":"Guyane","04":"La Réunion","06":"Mayotte"
};

const CDC_BASE = "https://data.cdc.gov/resource/mpgq-jmmr.json";
const NSSP_BASE = "https://data.cdc.gov/resource/rdmq-nq56.json";
const ODISSE_BASE = "https://odisse.santepubliquefrance.fr/api/explore/v2.1/catalog/datasets";

function tensionLevelUS(pctOcc) {
  // Codes neutres : la traduction fr/en se fait dans le template Liquid.
  if (pctOcc === null || pctOcc === undefined) return "unknown";
  if (pctOcc < 70) return "low";
  if (pctOcc < 85) return "moderate";
  return "high";
}

function num(v) {
  return v === null || v === undefined || v === "" ? null : Number(v);
}

function nsspTrendCode(label) {
  // Codes neutres, traduits dans le template Liquid.
  switch (label) {
    case "Increasing": return "up";
    case "Decreasing": return "down";
    case "No Change": return "stable";
    default: return "unknown"; // "Limited Data", "Insufficient Data", etc.
  }
}

async function fetchNsspForState(code) {
  const geography = code === "USA" ? "United States" : US_STATES[code];
  const trendSource = code === "USA" ? "United States" : "State";
  const where = encodeURIComponent(`geography="${geography}" AND county="All" AND trend_source="${trendSource}"`);
  const url = `${NSSP_BASE}?$where=${where}&$order=week_end DESC&$limit=1`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`NSSP ${code}: ${res.status}`);
  const rows = await res.json();
  if (!rows.length) return null;
  const r = rows[0];
  return {
    weekEnding: r.week_end?.slice(0, 10),
    pctVisitsCovid: num(r.percent_visits_smoothed_covid),
    pctVisitsFlu: num(r.percent_visits_smoothed_1),
    pctVisitsRsv: num(r.percent_visits_smoothed_rsv),
    trendCovid: nsspTrendCode(r.ed_trends_covid),
    trendFlu: nsspTrendCode(r.ed_trends_influenza),
    trendRsv: nsspTrendCode(r.ed_trends_rsv)
  };
}

async function fetchUsState(code) {
  const url = `${CDC_BASE}?jurisdiction=${code}&$order=weekendingdate DESC&$limit=8`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`CDC ${code}: ${res.status}`);
  const rows = await res.json();
  if (!rows.length) return null;

  const latest = rows[0];
  const prev = rows[1] || {};
  const history = rows.slice().reverse().map(r => ({
    week: r.weekendingdate?.slice(0, 10),
    pctInpt: num(r.pctinptbedsocc),
    pctIcu: num(r.pcticubedsocc)
  }));

  const pctBedsOccupied = num(latest.pctinptbedsocc);
  const prevPctBedsOccupied = num(prev.pctinptbedsocc);
  const deltaPts = (pctBedsOccupied !== null && prevPctBedsOccupied !== null)
    ? Math.round((pctBedsOccupied - prevPctBedsOccupied) * 10) / 10
    : null;

  let nssp = null;
  try {
    nssp = await fetchNsspForState(code);
  } catch (e) {
    console.error(e.message);
  }

  return {
    code,
    name: US_STATES[code],
    weekEnding: latest.weekendingdate?.slice(0, 10),
    pctBedsOccupied,
    pctBedsOccupiedAdult: num(latest.pctinptbedsoccadult),
    pctBedsOccupiedPed: num(latest.pctinptbedsoccped),
    pctIcuOccupied: num(latest.pcticubedsocc),
    pctIcuOccupiedAdult: num(latest.pcticubedsoccadult),
    pctIcuOccupiedPed: num(latest.pcticubedsoccped),
    deltaPts,
    reportingCoveragePct: num(latest.pctinptbedsoccperchosprep),
    reportingHospitals: num(latest.numinptbedshosprep),
    newAdmCovid: num(latest.totalconfc19newadm),
    newAdmFlu: num(latest.totalconfflunewadm),
    newAdmRsv: num(latest.totalconfrsvnewadm),
    newAdmCovidPer100k: num(latest.totalconfc19newadmper100k),
    newAdmFluPer100k: num(latest.totalconfflunewadmper100k),
    newAdmRsvPer100k: num(latest.totalconfrsvnewadmper100k),
    level: tensionLevelUS(pctBedsOccupied),
    nssp,
    history
  };
}

const FR_AGE_GROUPS = ["00-14 ans", "15-64 ans", "65 ans ou plus"];

const FR_PATHOLOGIES = {
  covid: { dataset: "covid-19-passages-aux-urgences-et-actes-sos-medecins-region", field: "taux_passages_covid_sau" },
  gastro: { dataset: "gastro-enterite-aigue-passages-aux-urgences-et-actes-sos-medecins-region", field: "taux_passages_gastro_sau" },
  bronchite: { dataset: "bronchite-passages-aux-urgences-et-actes-sos-medecins-region", field: "taux_passages_bronchite_sau" },
  pneumopathie: { dataset: "pneumopathie-passages-aux-urgences-et-actes-sos-medecins-region", field: "taux_passages_pneumopathie_sau" },
  orl: { dataset: "pathologies-orl-passages-aux-urgences-et-actes-sos-medecins-region", field: "taux_passages_orl_sau" },
  asthme: { dataset: "asthme-passages-aux-urgences-et-actes-sos-medecins-region", field: "taux_passages_asthme_sau" },
  allergie: { dataset: "allergie-passages-aux-urgences-et-actes-sos-medecins-region", field: "taux_passages_allergie_sau" }
};

function computeTrend(latestRate, prevRate) {
  let deltaPct = null;
  let trend = "stable";
  if (latestRate != null && prevRate != null && prevRate > 0) {
    deltaPct = Math.round(((latestRate - prevRate) / prevRate) * 1000) / 10;
    if (deltaPct > 8) trend = "up";
    else if (deltaPct < -8) trend = "down";
  }
  return { trend, deltaPct };
}

async function fetchFrRegion(regionCode) {
  // Combine deux indicateurs SurSaUD (Santé publique France) disponibles toute l'année :
  // - traumatismes (activité générale des urgences, non saisonnier)
  // - IRA (infections respiratoires aiguës, plus saisonnier)
  async function fetchDataset(dataset, rateField, ageFilter) {
    const where = encodeURIComponent(`region="${regionCode}" AND sursaud_cl_age_gene="${ageFilter}"`);
    const url = `${ODISSE_BASE}/${dataset}/records?where=${where}&order_by=date_complet desc&limit=8`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Odissé ${dataset} ${regionCode}: ${res.status}`);
    const json = await res.json();
    return json.results.slice().reverse().map(r => ({
      week: r.semaine,
      date: r.date_complet,
      rate: r[rateField] != null ? Number(r[rateField]) : null
    }));
  }

  const TRAUMA_DS = "traumatisme-passages-aux-urgences-et-actes-sos-medecins-region";
  const IRA_DS = "infections-respiratoires-aigues-ira-passages-aux-urgences-et-actes-sos-medecins-region";

  const pathologyKeys = Object.keys(FR_PATHOLOGIES);

  async function fetchPathologyLatestTwo(dataset, field) {
    const where = encodeURIComponent(`region="${regionCode}" AND sursaud_cl_age_gene="Tous âges"`);
    const url = `${ODISSE_BASE}/${dataset}/records?where=${where}&order_by=date_complet desc&limit=2`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Odissé ${dataset} ${regionCode}: ${res.status}`);
    const json = await res.json();
    return json.results; // [latest, previous] or fewer
  }

  const [trauma, ira, ...rest] = await Promise.all([
    fetchDataset(TRAUMA_DS, "taux_passages_trauma_sau", "Tous âges"),
    fetchDataset(IRA_DS, "taux_passages_ira_sau", "Tous âges"),
    ...FR_AGE_GROUPS.map(age => fetchDataset(TRAUMA_DS, "taux_passages_trauma_sau", age)),
    ...pathologyKeys.map(key => fetchPathologyLatestTwo(FR_PATHOLOGIES[key].dataset, FR_PATHOLOGIES[key].field))
  ]);

  const ageRows = rest.slice(0, FR_AGE_GROUPS.length);
  const pathologyRows = rest.slice(FR_AGE_GROUPS.length);

  if (!trauma.length && !ira.length) return null;

  const latestTrauma = trauma[trauma.length - 1] || {};
  const latestIra = ira[ira.length - 1] || {};
  const prevTrauma = trauma[trauma.length - 2] || {};

  let deltaPct = null;
  let trend = "stable";
  if (latestTrauma.rate != null && prevTrauma.rate != null && prevTrauma.rate > 0) {
    deltaPct = Math.round(((latestTrauma.rate - prevTrauma.rate) / prevTrauma.rate) * 1000) / 10;
    if (deltaPct > 8) trend = "up";
    else if (deltaPct < -8) trend = "down";
  }

  const byAge = {};
  FR_AGE_GROUPS.forEach((age, i) => {
    const rows = ageRows[i];
    const latest = rows[rows.length - 1];
    byAge[age] = latest ? latest.rate : null;
  });

  const pathologies = {};
  pathologyKeys.forEach((key, i) => {
    const rows = pathologyRows[i]; // [latest, previous]
    const field = FR_PATHOLOGIES[key].field;
    const latestRate = rows[0] ? num(rows[0][field]) : null;
    const prevRate = rows[1] ? num(rows[1][field]) : null;
    const { trend: pTrend } = computeTrend(latestRate, prevRate);
    pathologies[key] = { rate: latestRate, trend: pTrend };
  });

  return {
    code: regionCode,
    name: FR_REGIONS[regionCode],
    weekEnding: latestTrauma.date || latestIra.date,
    tauxTraumaSAU: latestTrauma.rate ?? null,
    tauxIraSAU: latestIra.rate ?? null,
    deltaPct,
    trend,
    byAgeTrauma: {
      "0-14": byAge["00-14 ans"],
      "15-64": byAge["15-64 ans"],
      "65+": byAge["65 ans ou plus"]
    },
    pathologies,
    history: trauma.map((t, i) => ({
      week: t.week,
      trauma: t.rate,
      ira: ira[i] ? ira[i].rate : null
    }))
  };
}

async function main() {
  console.log("Fetching US (CDC NHSN)...");
  const usStates = {};
  for (const code of Object.keys(US_STATES)) {
    try {
      const data = await fetchUsState(code);
      if (data) usStates[code] = data;
    } catch (e) {
      console.error(e.message);
    }
  }

  console.log("Fetching France (Odissé / SurSaUD)...");
  const frRegions = {};
  for (const code of Object.keys(FR_REGIONS)) {
    try {
      const data = await fetchFrRegion(code);
      if (data) frRegions[code] = data;
    } catch (e) {
      console.error(e.message);
    }
  }

  const usNameToCode = {};
  Object.entries(US_STATES).forEach(([code, name]) => { usNameToCode[name] = code; });

  const frNameToCode = {};
  Object.entries(FR_REGIONS).forEach(([code, name]) => { frNameToCode[name] = code; });

  const output = {
    generatedAt: new Date().toISOString(),
    us: usStates,
    fr: frRegions,
    usNameToCode,
    frNameToCode
  };

  const fs = await import("fs");
  fs.writeFileSync("data.json", JSON.stringify(output));
  console.log(`Done. ${Object.keys(usStates).length} US jurisdictions, ${Object.keys(frRegions).length} FR regions.`);
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});

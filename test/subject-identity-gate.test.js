"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { applySubjectIdentityGate } = require("../src/ai/tasks/t02-relevance-class/subject-identity-gate");
const { shouldFormIssue, branchForDecision } = require("../src/ai/tasks/t02-relevance-class/relevance-policy");

const arunikaFields = {
  name: "PT Arunika Hospitality Indonesia (Arunika Hospitality Group)",
  industry: "Perhotelan (Hotel, Restoran, Food & Beverage)",
  sub_industry: "Hotel and restaurant management",
  products: ["Hotel mewah, hotel butik, dan hotel bisnis", "Resor pantai dan resor destinasi", "Restoran (fine dining)"],
  topics: ["Operasi hotel dan layanan tamu", "Konsep kuliner"],
  priorities: ["Memperkuat pemesanan langsung dan layanan digital tamu"],
  goals: [],
  regions: ["Indonesia", "Jakarta", "Bandung"],
  competitors: [],
  brands_aliases: ["Arunika Grand Bali", "Casa Arunika Jakarta"],
  key_people: ["Maya Santoso"],
  customers: [],
  risks: [],
  dependencies: [],
  description: "Hospitality group based in Jakarta",
};

const manufacturingFields = {
  name: "PT Nexora Logistics Manufacturing",
  industry: "Manufacturing and logistics",
  sub_industry: "Industrial equipment and fleet logistics",
  products: ["Fleet telemetry modules", "Cold-chain packing lines"],
  topics: ["Supply chain resilience", "Factory automation"],
  priorities: ["Reduce outbound delay"],
  goals: ["Expand regional hubs"],
  regions: ["Indonesia", "Surabaya"],
  competitors: ["Helix Freight Systems", "Orbit Pack Industri"],
  brands_aliases: ["Nexora FleetCore"],
  key_people: ["Rina Kartika"],
  customers: ["Regional distributors"],
  risks: [],
  dependencies: [],
  description: "Manufacturing and logistics operator",
};

const fintechFields = {
  name: "AurumPay Financial Services",
  industry: "Financial services / fintech",
  sub_industry: "Digital payments and SME lending",
  products: ["SME working-capital loans", "Merchant QR payments"],
  topics: ["Payment rails", "Credit underwriting"],
  priorities: ["Grow merchant acceptance"],
  goals: [],
  regions: ["Indonesia", "Jakarta"],
  competitors: ["NovaLedger Bank", "PixelClear Payments"],
  brands_aliases: ["AurumPay QR", "AurumKredit"],
  key_people: ["Dewi Lestari"],
  customers: ["SMEs"],
  risks: [],
  dependencies: [],
  description: "Digital payments and lending",
};

test("Sutan Raja peer promo is market and never forms an issue (Context A)", () => {
  const gated = applySubjectIdentityGate({
    relevance: "medium",
    confidence: 0.7,
    subjectRelation: "self",
    fields: arunikaFields,
    title: "Sutan Raja Hotel Convention Centre Soreang Luncurkan Promo July Mid Year Magic",
    summary: "Sutan Raja Hotel Soreang menghadirkan promo July Mid Year Magic sepanjang Juli. Menginap mulai Rp550 ribu dan diskon direct booking.",
  });
  assert.equal(gated.subjectRelation, "market");
  assert.equal(gated.relevance, "low");
  assert.equal(shouldFormIssue({
    relevance: gated.relevance,
    subjectRelation: gated.subjectRelation,
    competitorOptIn: gated.competitorOptIn,
  }), false);
  assert.equal(branchForDecision({
    relevance: gated.relevance,
    subjectRelation: gated.subjectRelation,
    competitorOptIn: gated.competitorOptIn,
  }), "stop");
});

test("Rumah Makan Padang peer promo is market for hospitality context", () => {
  const gated = applySubjectIdentityGate({
    relevance: "medium",
    confidence: 0.65,
    subjectRelation: "self",
    fields: arunikaFields,
    title: "Dukung UMKM Lokal: Rumah Makan Padang Gelar The Heritage Weekend Market",
    summary: "Gadang Barubah rumah makan Padang meluncurkan pasar akhir pekan bagi UMKM food and beverage.",
  });
  assert.equal(gated.subjectRelation, "market");
  assert.equal(shouldFormIssue({
    relevance: gated.relevance,
    subjectRelation: gated.subjectRelation,
    competitorOptIn: false,
  }), false);
});

test("Arunika self mention remains self and can form issues", () => {
  const gated = applySubjectIdentityGate({
    relevance: "high",
    confidence: 0.9,
    subjectRelation: "self",
    fields: arunikaFields,
    title: "Arunika Hospitality Group buka resor baru di Bali",
    summary: "PT Arunika Hospitality Indonesia meresmikan properti resor pantai baru untuk tamu bisnis.",
  });
  assert.equal(gated.subjectRelation, "self");
  assert.equal(gated.relevance, "high");
  assert.equal(shouldFormIssue({
    relevance: gated.relevance,
    subjectRelation: gated.subjectRelation,
    competitorOptIn: gated.competitorOptIn,
  }), true);
});

test("Manufacturing: unlisted peer factory news is market (Context B)", () => {
  const gated = applySubjectIdentityGate({
    relevance: "medium",
    confidence: 0.7,
    subjectRelation: "self",
    fields: manufacturingFields,
    title: "Pabrik Baja Merdeka buka jalur packing baru di Gresik",
    summary: "Pabrik Baja Merdeka menambah kapasitas packing industri tanpa menyebut Nexora.",
  });
  assert.equal(gated.subjectRelation, "market");
  assert.equal(shouldFormIssue({
    relevance: gated.relevance,
    subjectRelation: gated.subjectRelation,
    competitorOptIn: true,
  }), false);
});

test("Manufacturing: listed competitor forms competitor issue when opt-in", () => {
  const gated = applySubjectIdentityGate({
    relevance: "medium",
    confidence: 0.75,
    subjectRelation: "competitor",
    fields: manufacturingFields,
    title: "Helix Freight Systems expands cold-chain fleet in Surabaya",
    summary: "Helix Freight Systems opened a new cold-chain packing depot competing on outbound delay.",
  });
  assert.equal(gated.subjectRelation, "competitor");
  assert.equal(gated.competitorOptIn, true);
  assert.equal(shouldFormIssue({
    relevance: gated.relevance,
    subjectRelation: gated.subjectRelation,
    competitorOptIn: gated.competitorOptIn,
  }), true);
});

test("Fintech: another bank promo is market (Context C)", () => {
  const gated = applySubjectIdentityGate({
    relevance: "high",
    confidence: 0.8,
    subjectRelation: "self",
    fields: fintechFields,
    title: "Bank Nusantara luncurkan promo cashback QR merchant",
    summary: "Bank Nusantara menawarkan cashback untuk pembayaran QR di warung kota besar.",
  });
  assert.equal(gated.subjectRelation, "market");
  assert.equal(shouldFormIssue({
    relevance: gated.relevance,
    subjectRelation: gated.subjectRelation,
    competitorOptIn: true,
  }), false);
});

test("Body-only legal name recall promotes self", () => {
  const gated = applySubjectIdentityGate({
    relevance: "none",
    confidence: 0.4,
    subjectRelation: "unrelated",
    fields: arunikaFields,
    title: "Investor tinjau peluang properti hospitality di Bali",
    summary: "Analis mencatat minat baru pada manajemen hotel premium.",
    body: "Dalam pertemuan tertutup, manajemen PT Arunika Hospitality Indonesia memaparkan pipeline pra-pembukaan.",
  });
  assert.equal(gated.subjectRelation, "self");
  assert.equal(shouldFormIssue({
    relevance: gated.relevance,
    subjectRelation: gated.subjectRelation,
    competitorOptIn: false,
  }), true);
});

test("Brand alias in body recalls self", () => {
  const gated = applySubjectIdentityGate({
    relevance: "low",
    confidence: 0.4,
    subjectRelation: "market",
    fields: arunikaFields,
    title: "Resor pantai di Bali perbarui program spa",
    summary: "Beberapa properti menyiapkan paket wellness.",
    body: "Arunika Grand Bali menambah treatment lokal dan kemitraan spa.",
  });
  assert.equal(gated.subjectRelation, "self");
  assert.ok(gated.selfHits.length > 0);
});

test("Key person title hit is self", () => {
  const gated = applySubjectIdentityGate({
    relevance: "medium",
    confidence: 0.7,
    subjectRelation: "market",
    fields: arunikaFields,
    title: "Maya Santoso tegaskan fokus pengalaman tamu",
    summary: "Eksekutif menekankan diferensiasi layanan.",
  });
  assert.equal(gated.subjectRelation, "self");
});

test("Fintech: listed competitor NovaLedger is competitor", () => {
  const gated = applySubjectIdentityGate({
    relevance: "medium",
    confidence: 0.7,
    subjectRelation: "competitor",
    fields: fintechFields,
    title: "NovaLedger Bank raises SME lending rates",
    summary: "NovaLedger Bank adjusted working-capital loan pricing for merchants.",
  });
  assert.equal(gated.subjectRelation, "competitor");
  assert.equal(shouldFormIssue({
    relevance: gated.relevance,
    subjectRelation: gated.subjectRelation,
    competitorOptIn: true,
  }), true);
});

test("Empty competitors list never allows competitor relation", () => {
  const gated = applySubjectIdentityGate({
    relevance: "medium",
    confidence: 0.7,
    subjectRelation: "competitor",
    fields: arunikaFields,
    title: "Some Hotel Group expands in Bandung",
    summary: "A peer hotel operator expands with direct booking promo.",
  });
  assert.notEqual(gated.subjectRelation, "competitor");
  assert.equal(gated.competitorOptIn, false);
});

test("Legacy decisions without subject_relation fail closed", () => {
  assert.equal(branchForDecision({ relevance: "medium", subjectRelation: null }), "stop");
  assert.equal(branchForDecision({ relevance: "high" }), "stop");
});

test("red-team: scattered token alias must not form self/competitor issues", () => {
  const attacks = [
    {
      fields: arunikaFields,
      title: "Arunika Sari Wins Hotel Hospitality Manager of the Year",
      summary: "Bali hotel operators praised Arunika Sari for hospitality excellence at a major resort property.",
    },
    {
      fields: manufacturingFields,
      title: "Low-Earth Orbit Startup Scales Industrial Packing Automation",
      summary: "A space-tech firm is adapting orbit sensor firmware to automate industrial packing lines at factories.",
    },
    {
      fields: manufacturingFields,
      title: "Cascade Coffee Expands Logistics Network Across Java",
      summary: "The Cascade coffee retail brand opened new logistics centers to speed bean distribution.",
    },
    {
      fields: fintechFields,
      title: "PixelClear Display Maker Enters Consumer Payments Hardware",
      summary: "PixelClear, known for LED screens, announced a pivot into payments terminals for retail merchants.",
    },
    {
      fields: manufacturingFields,
      title: "Nexora University Opens Logistics Manufacturing Research Lab",
      summary: "Nexora University launched a logistics manufacturing research lab focused on factory automation.",
    },
  ];
  for (const attack of attacks) {
    const gated = applySubjectIdentityGate({
      relevance: "medium",
      confidence: 0.7,
      subjectRelation: "market",
      fields: attack.fields,
      title: attack.title,
      summary: attack.summary,
    });
    assert.notEqual(gated.subjectRelation, "self", attack.title);
    assert.equal(shouldFormIssue({
      relevance: gated.relevance,
      subjectRelation: gated.subjectRelation,
      competitorOptIn: gated.competitorOptIn,
    }), false, attack.title);
  }
});

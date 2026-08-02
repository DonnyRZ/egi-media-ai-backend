"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("fs");
const path = require("path");
const { applyMarketMaterialityGate } = require("../src/ai/tasks/t02-relevance-class/market-materiality-gate");
const { shouldFormIssue } = require("../src/ai/tasks/t02-relevance-class/relevance-policy");

const casesPath = path.join(__dirname, "../eval/management-intelligence/production-cases.json");
const fixture = JSON.parse(fs.readFileSync(casesPath, "utf8"));
const fields = fixture.context.fields;

function gateCase(id, relevance = "medium") {
  const item = fixture.cases.find((entry) => entry.id === id);
  assert.ok(item, `missing case ${id}`);
  return applyMarketMaterialityGate({
    relevance,
    confidence: 0.8,
    subjectRelation: "market",
    fields,
    title: item.source.article.title,
    summary: item.source.article.summary,
  });
}

test("market materiality gate keeps concrete peer lodging promo", () => {
  const gated = gateCase("TP-1");
  assert.equal(gated.gated, false);
  assert.equal(gated.relevance, "medium");
  assert.equal(shouldFormIssue({ relevance: gated.relevance, subjectRelation: "market" }), true);
});

test("market materiality gate keeps region infrastructure project", () => {
  const gated = gateCase("TP-2", "high");
  assert.equal(gated.gated, false);
  assert.equal(gated.relevance, "high");
  assert.ok([
    "product_industry_overlap",
    "region_project_or_regulation",
    "product_category_commercial_action",
    "operating_area_infrastructure_demand",
  ].includes(gated.hook));
});

test("market materiality gate keeps peer dining commercial event", () => {
  const gated = gateCase("TP-3", "medium");
  assert.equal(gated.gated, false, `Padang should keep, got reason=${gated.reason}`);
  assert.equal(gated.relevance, "medium");
});

test("market materiality gate upgrades underrated peer dining commercial event from low", () => {
  const gated = gateCase("TP-3", "low");
  assert.equal(gated.gated, true);
  assert.equal(gated.reason, "peer_commercial_action_upgrade");
  assert.equal(gated.relevance, "medium");
  assert.equal(shouldFormIssue({ relevance: gated.relevance, subjectRelation: "market" }), true);
});

test("market materiality gate demotes local roadwork even if model says medium", () => {
  const gated = gateCase("TN-2", "medium");
  assert.equal(gated.gated, true);
  assert.equal(gated.relevance, "low");
  assert.equal(shouldFormIssue({ relevance: gated.relevance, subjectRelation: "market" }), false);
});

test("market materiality gate does not upgrade false positives from low", () => {
  for (const id of ["FP-1", "FP-2", "FP-3", "FP-4", "TN-2"]) {
    const gated = gateCase(id, "low");
    assert.equal(gated.relevance, "low", `${id} must stay low when model already says low`);
    assert.ok(!String(gated.reason || "").includes("upgrade"), `${id} unexpected upgrade ${gated.reason}`);
  }
});

test("market materiality gate stops unrelated vendor water-heater metric", () => {
  const gated = gateCase("FP-1");
  assert.equal(gated.gated, true);
  assert.equal(gated.relevance, "low");
  assert.equal(gated.reason, "market_without_direct_context_hook");
  assert.equal(shouldFormIssue({ relevance: gated.relevance, subjectRelation: "market" }), false);
});

test("market materiality gate stops labour advocacy without direct product hook", () => {
  const gated = gateCase("FP-2");
  assert.equal(gated.gated, true);
  assert.equal(gated.relevance, "low");
});

test("market materiality gate stops generic equity-index movement", () => {
  const gated = gateCase("FP-3");
  assert.equal(gated.gated, true);
  assert.equal(gated.relevance, "low");
});

test("market materiality gate stops broad mangrove programme without property hook in title/summary", () => {
  const gated = gateCase("FP-4");
  assert.equal(gated.gated, true);
  assert.equal(gated.relevance, "low");
});

test("market materiality gate does not alter self/competitor continuing decisions", () => {
  const gated = applyMarketMaterialityGate({
    relevance: "high",
    confidence: 0.9,
    subjectRelation: "self",
    fields,
    title: "Unrelated sports score update",
    summary: "A football match ended 2-1.",
  });
  assert.equal(gated.gated, false);
  assert.equal(gated.relevance, "high");
});

test("manufacturing family keeps peer factory news without hospitality tokens", () => {
  const manufacturing = {
    name: "Vector Components",
    industry: "Industrial components manufacturing",
    products: ["Precision control modules"],
    regions: ["Industrial Zone Three"],
    topics: [],
    priorities: [],
    goals: [],
    dependencies: [],
    competitors: [],
  };
  const gated = applyMarketMaterialityGate({
    relevance: "medium",
    confidence: 0.8,
    subjectRelation: "market",
    fields: manufacturing,
    title: "Peer factory expands automated packing line nearby",
    summary: "A component plant launches a new production expansion in the industrial zone.",
  });
  assert.equal(gated.gated, false);
  assert.ok(gated.hook);
});

test("generic context event bridge rescues a concrete construction cost change", () => {
  const construction = {
    industry: "Construction and infrastructure",
    products: ["Infrastructure delivery", "Project controls"],
    risks: ["Cost overruns and changes", "Supply-chain, logistics, and material-traceability risks"],
    priorities: ["Cost visibility and disciplined commercial control"],
    dependencies: ["Equipment providers and critical-material suppliers"],
    regions: ["Indonesia"],
  };
  const gated = applyMarketMaterialityGate({
    relevance: "low",
    confidence: 0.9,
    subjectRelation: "market",
    fields: construction,
    title: "Harga bahan bakar berpotensi tetap tinggi hingga akhir 2026",
    summary: "Tekanan energi diperkirakan menaikkan biaya operasional dan pengiriman.",
  });
  assert.equal(gated.relevance, "medium");
  assert.equal(gated.reason, "context_event_bridge_upgrade");
  assert.equal(gated.hook, "context_cost_supply_energy_change");
});

test("generic context event bridge rescues safety and quality events across industries", () => {
  const logistics = {
    industry: "Logistics and supply chain",
    products: ["Domestic transportation", "International freight forwarding"],
    risks: ["Transport safety and driver fatigue", "Business disruption and capacity constraints"],
    priorities: ["Reliable and safe transport and facility operations"],
    dependencies: ["Carriers and strategic logistics partners"],
    regions: ["Indonesia"],
  };
  const logisticsResult = applyMarketMaterialityGate({
    relevance: "none",
    confidence: 0.9,
    subjectRelation: "market",
    fields: logistics,
    title: "Cegah kecelakaan, pemerintah minta ribuan lintasan KA dipasang pintu otomatis",
    summary: "Kebijakan keselamatan transportasi nasional diumumkan.",
  });
  assert.equal(logisticsResult.relevance, "medium");
  assert.equal(logisticsResult.hook, "context_safety_or_disruption_event");

  const fmcg = {
    industry: "Fast-moving consumer goods",
    products: ["Food and snacks", "Food service solutions"],
    risks: ["Food and product safety", "Supplier quality failures"],
    priorities: ["Trusted product quality and safety"],
    regions: ["Indonesia"],
  };
  const fmcgResult = applyMarketMaterialityGate({
    relevance: "none",
    confidence: 0.9,
    subjectRelation: "market",
    fields: fmcg,
    title: "Audit menemukan ribuan dapur penyedia makanan bermasalah",
    summary: "Temuan ini memicu pengetatan kontrol kualitas dan keamanan pangan.",
  });
  assert.equal(fmcgResult.relevance, "medium");
  assert.equal(fmcgResult.hook, "context_regulatory_quality_event");
});

test("generic context event bridge rescues clinical workforce and food-integrity signals", () => {
  const hospital = {
    industry: "Healthcare",
    products: ["Advanced diagnostics and surgery"],
    risks: ["Patient safety", "Clinical governance and credentialing"],
    priorities: ["Patient safety and clinical quality"],
    dependencies: ["Multidisciplinary physicians, nurses, and clinical support teams"],
    regions: ["Jakarta"],
  };
  const hospitalResult = applyMarketMaterialityGate({
    relevance: "none",
    confidence: 0.9,
    subjectRelation: "market",
    fields: hospital,
    title: "Rentetan insiden dokter internship tewas, tanggung jawab siapa?",
    summary: "Insiden ini memicu perhatian pada keselamatan tenaga kesehatan.",
  });
  assert.equal(hospitalResult.relevance, "medium");

  const agriculture = {
    industry: "Agriculture and agribusiness",
    products: ["Milling, sorting, packing, and primary processing"],
    risks: ["Food safety and chemical-residue risk", "Operational, quality, traceability, and supply-chain risk"],
    priorities: ["Product quality, food safety, and traceability"],
    regions: ["Indonesia"],
  };
  const agricultureResult = applyMarketMaterialityGate({
    relevance: "low",
    confidence: 0.9,
    subjectRelation: "market",
    fields: agriculture,
    title: "Mentan temukan beras fortifikasi bermasalah",
    summary: "Temuan kualitas pangan dapat memicu penegakan standar dan penarikan produk.",
  });
  assert.equal(agricultureResult.relevance, "medium");
  assert.equal(agricultureResult.hook, "context_regulatory_quality_event");
});

test("payment context keeps cross-border QRIS as a material product signal", () => {
  const technology = {
    industry: "Technology services",
    products: ["Digital onboarding and payment platforms"],
    risks: ["Privacy, regulatory, and compliance exposure"],
    priorities: ["Grow customer experiences and digital revenue streams"],
    regions: ["Indonesia", "Singapore"],
  };
  const gated = applyMarketMaterialityGate({
    relevance: "low",
    confidence: 0.8,
    subjectRelation: "market",
    fields: technology,
    title: "Enam negara bisa pakai QRIS untuk transaksi, ada Jepang hingga China",
    summary: "Perluasan pembayaran lintas negara membuka perubahan pada ekosistem transaksi digital.",
  });
  assert.equal(gated.relevance, "medium");
  assert.equal(gated.hook, "context_digital_payment_product_change");
});

test("credit macro news is not upgraded by the payment product category", () => {
  const technology = {
    industry: "Technology services",
    products: ["Digital onboarding and payment platforms"],
    risks: ["Privacy, regulatory, and compliance exposure"],
    priorities: ["Grow customer experiences and digital revenue streams"],
    regions: ["Indonesia"],
  };
  const gated = applyMarketMaterialityGate({
    relevance: "low",
    confidence: 0.9,
    subjectRelation: "market",
    fields: technology,
    title: "Kredit perbankan dunia usaha tak cair",
    summary: "Permintaan kredit bisnis melemah dan tidak terkait dengan platform pembayaran perusahaan.",
  });
  assert.equal(gated.relevance, "low");
  assert.equal(gated.reason, null);
});

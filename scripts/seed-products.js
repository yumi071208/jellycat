// scripts/seed-products.js
// Seed products from public/images with category mapping.
// Usage: node scripts/seed-products.js

const path = require("path");
const fs = require("fs");
const mysql = require("mysql2/promise");
require("dotenv").config();

const DEFAULT_PRICE = 68.0;
const DEFAULT_STOCK = 10;

const categoryRules = [
  { match: /bunny|bunnies/i, category: "Bunnies" },
  { match: /amuseables?/i, category: "Amuseables" },
  { match: /charm/i, category: "Charms" },
  { match: /dust bag|bag|merch/i, category: "Merchandise" },
  { match: /retired|limited|exclusive|hero-retired/i, category: "Retired" },
  { match: /bear|monkey|cat|animal|classic/i, category: "Animals" }
];

function mapCategory(filename) {
  for (const rule of categoryRules) {
    if (rule.match.test(filename)) return rule.category;
  }
  return "Animals";
}

function toProductName(filename) {
  const name = path.basename(filename, path.extname(filename));
  return name.replace(/\s+/g, " ").trim();
}

async function run() {
  const imagesDir = path.join(__dirname, "..", "public", "images");
  const files = fs
    .readdirSync(imagesDir)
    .filter((f) => f.toLowerCase().endsWith(".png"));

  if (files.length === 0) {
    console.log("No .png images found in public/images.");
    return;
  }

  const rows = files.map((file) => [
    toProductName(file),
    "",
    DEFAULT_PRICE,
    file,
    DEFAULT_STOCK,
    mapCategory(file)
  ]);

  const db = await mysql.createConnection({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME
  });

  await db.query(
    "INSERT INTO products (name, description, price, image_url, stock, category) VALUES ?",
    [rows]
  );

  await db.end();
  console.log(`Seeded ${rows.length} products.`);
}

run().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});

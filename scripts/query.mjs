#!/usr/bin/env node
// owntracks-query: CLI to query current location and nearby places
// Usage:
//   node query.mjs                    — current location + nearest place
//   node query.mjs --history 5        — last N locations
//   node query.mjs --at "2026-03-10"  — locations from a specific date
//
// ENV:
//   DATA_DIR    — data directory (default: ../data relative to this script)
//   PLACES_FILE — places config (default: ../places.json, falls back to places.example.json)

import { readFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

const SCRIPT_DIR = import.meta.dirname;
const DATA_DIR = resolve(process.env.DATA_DIR || join(SCRIPT_DIR, '..', 'data'));
const PLACES_FILE = resolve(process.env.PLACES_FILE || join(SCRIPT_DIR, '..', 'places.json'));
const PLACES_EXAMPLE = join(SCRIPT_DIR, 'places.example.json');
const CURRENT_FILE = join(DATA_DIR, 'current-location.json');
const LOG_FILE = join(DATA_DIR, 'location-log.jsonl');

// Haversine distance in meters
function distanceM(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const toRad = d => d * Math.PI / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat/2)**2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

function loadPlaces() {
  for (const f of [PLACES_FILE, PLACES_EXAMPLE]) {
    if (existsSync(f)) {
      try { return JSON.parse(readFileSync(f, 'utf8')).places || []; } catch { }
    }
  }
  return [];
}

function nearestPlace(lat, lon, places) {
  let best = null, bestDist = Infinity;
  for (const p of places) {
    const d = distanceM(lat, lon, p.lat, p.lon);
    if (d < bestDist) { bestDist = d; best = p; }
  }
  if (!best) return null;
  return { ...best, distance: Math.round(bestDist), inside: bestDist <= (best.radius || 200) };
}

function formatLocation(loc, places) {
  const nearest = nearestPlace(loc.lat, loc.lon, places);
  const parts = [
    `📍 ${loc.lat}, ${loc.lon}`,
    loc.acc ? `acc: ${loc.acc}m` : null,
    loc.batt ? `batt: ${loc.batt}%` : null,
    loc.conn ? `conn: ${loc.conn === 'w' ? 'wifi' : loc.conn === 'm' ? 'mobile' : loc.conn}` : null,
    `time: ${loc.timestamp || new Date(loc.tst * 1000).toISOString()}`
  ].filter(Boolean);

  let line = parts.join(' | ');
  if (nearest) {
    if (nearest.inside) {
      line += `\n   📌 At ${nearest.label || nearest.name}`;
    } else {
      line += `\n   📌 ${nearest.distance}m from ${nearest.label || nearest.name}`;
    }
  }
  return line;
}

// Parse args
const args = process.argv.slice(2);
const places = loadPlaces();

if (args.includes('--history')) {
  const n = parseInt(args[args.indexOf('--history') + 1] || '5', 10);
  if (!existsSync(LOG_FILE)) { console.log('No location history yet.'); process.exit(0); }
  const lines = readFileSync(LOG_FILE, 'utf8').trim().split('\n');
  const recent = lines.slice(-n);
  for (const line of recent) {
    try { console.log(formatLocation(JSON.parse(line), places)); } catch {}
  }
} else if (args.includes('--at')) {
  const date = args[args.indexOf('--at') + 1] || '';
  if (!existsSync(LOG_FILE)) { console.log('No location history yet.'); process.exit(0); }
  const lines = readFileSync(LOG_FILE, 'utf8').trim().split('\n');
  let count = 0;
  for (const line of lines) {
    try {
      const loc = JSON.parse(line);
      const ts = loc.timestamp || new Date(loc.tst * 1000).toISOString();
      if (ts.startsWith(date)) { console.log(formatLocation(loc, places)); count++; }
    } catch {}
  }
  if (!count) console.log(`No locations found for ${date}`);
} else if (args.includes('--places')) {
  if (!places.length) { console.log('No places configured. Copy places.example.json to places.json and edit.'); process.exit(0); }
  for (const p of places) {
    console.log(`📌 ${p.label || p.name} (${p.name}) — ${p.lat}, ${p.lon} r=${p.radius || 200}m`);
  }
} else if (args.includes('--json')) {
  if (!existsSync(CURRENT_FILE)) { console.log('{}'); process.exit(0); }
  const loc = JSON.parse(readFileSync(CURRENT_FILE, 'utf8'));
  const nearest = nearestPlace(loc.lat, loc.lon, places);
  console.log(JSON.stringify({ ...loc, nearest }, null, 2));
} else {
  // Default: current location
  if (!existsSync(CURRENT_FILE)) {
    console.log('No location data yet. Waiting for first OwnTracks update.');
    process.exit(0);
  }
  const loc = JSON.parse(readFileSync(CURRENT_FILE, 'utf8'));
  console.log(formatLocation(loc, places));
}

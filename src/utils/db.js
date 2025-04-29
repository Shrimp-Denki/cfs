import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
let db;

export async function initDb() {
  db = await open({ filename: './confessions.sqlite', driver: sqlite3.Database });
  await db.exec(`
    CREATE TABLE IF NOT EXISTS confessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      content TEXT NOT NULL,
      user_id TEXT,
      approved INTEGER DEFAULT 0
    );
  `);
}

export async function addConfession(content, userId) {
  const res = await db.run(
    'INSERT INTO confessions (content, user_id) VALUES (?, ?)',
    [content, userId]
  );
  return res.lastID;
}

export async function fetchPendingConfessions(id) {
  return db.get('SELECT * FROM confessions WHERE id = ? AND approved = 0', [id]);
}

export async function markApproved(id) {
  return db.run('UPDATE confessions SET approved = 1 WHERE id = ?', [id]);
}

export async function getApprovedCount() {
  const row = await db.get('SELECT COUNT(*) AS count FROM confessions WHERE approved = 1');
  return row.count;
}

import fs from "fs";
import path from "path";
import Database from "better-sqlite3";

export type AppDb = Database.Database;

export function dataDir(): string {
  return process.env.DATA_DIR || path.join(process.cwd(), "private-data");
}

export function openDb(dir = dataDir()): AppDb {
  fs.mkdirSync(dir, { recursive: true });
  fs.mkdirSync(path.join(dir, "originals"), { recursive: true });
  const db = new Database(path.join(dir, "app.sqlite"));
  db.pragma("journal_mode = WAL");
  db.exec(`
    CREATE TABLE IF NOT EXISTS documents (
      id TEXT PRIMARY KEY,
      original_name TEXT NOT NULL,
      stored_path TEXT,
      title TEXT,
      title_source TEXT,
      sha256 TEXT NOT NULL,
      published_on TEXT,
      published_on_source TEXT,
      doc_type TEXT,
      department TEXT,
      department_source TEXT,
      access_scope TEXT NOT NULL,
      rights_status TEXT NOT NULL,
      ai_transfer TEXT NOT NULL,
      version_label TEXT,
      page_count INTEGER,
      extract_status TEXT NOT NULL,
      extract_note TEXT,
      is_synthetic INTEGER NOT NULL DEFAULT 0,
      handover_id TEXT,
      ignored_instructions TEXT,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS chunks (
      id TEXT PRIMARY KEY,
      document_id TEXT NOT NULL,
      physical_page INTEGER NOT NULL,
      printed_page TEXT,
      section_id TEXT,
      text TEXT NOT NULL,
      method TEXT NOT NULL,
      quality TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS index_jobs (
      id TEXT PRIMARY KEY,
      document_id TEXT NOT NULL,
      stage TEXT NOT NULL,
      attempts INTEGER NOT NULL DEFAULT 0,
      started_at TEXT,
      finished_at TEXT,
      error_summary TEXT,
      resume_at TEXT,
      parser_version TEXT NOT NULL,
      index_version TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS handovers (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      predecessor_role TEXT NOT NULL,
      successor_role TEXT NOT NULL,
      scope TEXT NOT NULL,
      as_of TEXT NOT NULL,
      timezone TEXT NOT NULL,
      facts TEXT NOT NULL,
      fact_sources TEXT NOT NULL,
      unknowns TEXT NOT NULL,
      geo TEXT NOT NULL,
      observations TEXT NOT NULL,
      question TEXT NOT NULL,
      status TEXT NOT NULL,
      current_version INTEGER NOT NULL DEFAULT 1,
      confirmed_version INTEGER,
      accepted_version INTEGER,
      accepted_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS handover_items (
      id TEXT PRIMARY KEY,
      handover_id TEXT NOT NULL,
      version INTEGER NOT NULL,
      item_kind TEXT NOT NULL,
      statement_kind TEXT NOT NULL,
      purpose TEXT NOT NULL,
      status_text TEXT NOT NULL,
      judgment TEXT NOT NULL,
      next_action TEXT NOT NULL,
      owner_role TEXT,
      due_on TEXT,
      consult_with TEXT,
      evidence_ids TEXT NOT NULL,
      supplement TEXT NOT NULL,
      review_status TEXT NOT NULL,
      task_status TEXT NOT NULL,
      sort_order INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS evidences (
      id TEXT PRIMARY KEY,
      handover_id TEXT NOT NULL,
      chunk_id TEXT NOT NULL,
      document_id TEXT NOT NULL,
      location TEXT NOT NULL,
      excerpt TEXT NOT NULL,
      claim TEXT NOT NULL,
      verification_status TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS candidates (
      id TEXT PRIMARY KEY,
      handover_id TEXT NOT NULL,
      mode TEXT NOT NULL,
      document_id TEXT NOT NULL,
      period_label TEXT,
      score REAL NOT NULL,
      score_method TEXT NOT NULL,
      similarity TEXT NOT NULL,
      differences TEXT NOT NULL,
      gaps TEXT NOT NULL,
      review_status TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS conflicts (
      id TEXT PRIMARY KEY,
      handover_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      note TEXT NOT NULL,
      evidence_ids TEXT NOT NULL,
      resolution TEXT,
      resolution_note TEXT,
      resolved_at TEXT
    );
    CREATE TABLE IF NOT EXISTS review_events (
      id TEXT PRIMARY KEY,
      handover_id TEXT NOT NULL,
      actor TEXT NOT NULL,
      actor_role TEXT NOT NULL,
      before_json TEXT NOT NULL,
      after_json TEXT NOT NULL,
      reason TEXT NOT NULL,
      at TEXT NOT NULL,
      version INTEGER NOT NULL,
      result TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS generation_runs (
      id TEXT PRIMARY KEY,
      handover_id TEXT,
      provider TEXT NOT NULL,
      model TEXT NOT NULL,
      prompt_version TEXT NOT NULL,
      as_of TEXT,
      evidence_ids TEXT NOT NULL,
      input_status TEXT NOT NULL,
      output_status TEXT NOT NULL,
      duration_ms INTEGER,
      error TEXT,
      is_demo INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS interview (
      id TEXT PRIMARY KEY,
      handover_id TEXT NOT NULL,
      question_id TEXT NOT NULL,
      question TEXT NOT NULL,
      why TEXT NOT NULL,
      answer TEXT,
      linked_item_kind TEXT
    );
    CREATE TABLE IF NOT EXISTS settings (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      org_name TEXT NOT NULL,
      work_types TEXT NOT NULL,
      mode TEXT NOT NULL,
      model_base_url TEXT NOT NULL,
      model_name TEXT NOT NULL,
      embed_model TEXT,
      timeout_ms INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS successor_questions (
      id TEXT PRIMARY KEY,
      handover_id TEXT NOT NULL,
      question TEXT NOT NULL,
      answer TEXT NOT NULL,
      used_status TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
  `);
  const settings = db.prepare("SELECT id FROM settings WHERE id = 1").get();
  if (!settings) {
    db.prepare(
      `INSERT INTO settings (id, org_name, work_types, mode, model_base_url, model_name, embed_model, timeout_ms)
       VALUES (1, '가상 기관', '석유 시황 인수인계', 'demo', 'https://api.openai.com/v1', '', '', 60000)`,
    ).run();
  }
  return db;
}

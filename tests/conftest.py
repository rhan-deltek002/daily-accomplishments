import sqlite3
import pytest
import sys
import os

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))
import db


@pytest.fixture
def tmp_db(tmp_path):
    """Fresh, initialized database."""
    path = str(tmp_path / "test.db")
    db.init_db(path)
    return path


@pytest.fixture
def old_schema_db(tmp_path):
    """Database with the pre-project-field schema (simulates an existing user's DB)."""
    path = str(tmp_path / "old.db")
    conn = sqlite3.connect(path)
    conn.execute("""
        CREATE TABLE accomplishments (
            id           INTEGER PRIMARY KEY AUTOINCREMENT,
            title        TEXT    NOT NULL,
            description  TEXT    NOT NULL,
            category     TEXT    NOT NULL,
            impact_level TEXT    NOT NULL DEFAULT 'medium',
            tags         TEXT    DEFAULT '[]',
            context      TEXT    NOT NULL DEFAULT 'work',
            date         DATE    NOT NULL DEFAULT (date('now')),
            created_at   DATETIME NOT NULL DEFAULT (datetime('now'))
        )
    """)
    conn.commit()
    conn.close()
    return path

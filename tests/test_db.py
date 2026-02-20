"""Unit tests for db.py."""
import sqlite3
import pytest
import db


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _columns(db_path):
    conn = sqlite3.connect(db_path)
    cols = {row[1] for row in conn.execute("PRAGMA table_info(accomplishments)")}
    conn.close()
    return cols


def _log(db_path, title="Title", description="Desc", category="feature", **kwargs):
    """Shorthand for logging a record."""
    return db.log_accomplishment(db_path, title, description, category, **kwargs)


# ---------------------------------------------------------------------------
# Migration
# ---------------------------------------------------------------------------

class TestMigration:
    def test_fresh_db_has_project_column(self, tmp_db):
        assert "project" in _columns(tmp_db)

    def test_fresh_db_has_context_column(self, tmp_db):
        assert "context" in _columns(tmp_db)

    def test_migration_adds_project_to_old_schema(self, old_schema_db):
        assert "project" not in _columns(old_schema_db)
        db.init_db(old_schema_db)
        assert "project" in _columns(old_schema_db)

    def test_migration_is_idempotent(self, tmp_db):
        """Calling init_db twice must not raise."""
        db.init_db(tmp_db)
        db.init_db(tmp_db)
        assert "project" in _columns(tmp_db)


# ---------------------------------------------------------------------------
# log_accomplishment
# ---------------------------------------------------------------------------

class TestLogAccomplishment:
    def test_with_project(self, tmp_db):
        record = _log(tmp_db, project="my-app")
        assert record["project"] == "my-app"

    def test_without_project_defaults_to_none(self, tmp_db):
        record = _log(tmp_db)
        assert record["project"] is None

    def test_returns_id(self, tmp_db):
        record = _log(tmp_db)
        assert isinstance(record["id"], int)

    def test_context_default(self, tmp_db):
        record = _log(tmp_db)
        assert record["context"] == "work"

    def test_all_fields_stored(self, tmp_db):
        record = _log(
            tmp_db,
            title="My title",
            description="My desc",
            category="bugfix",
            impact_level="high",
            tags=["python", "api"],
            context="side_project",
            project="cool-app",
        )
        assert record["title"] == "My title"
        assert record["category"] == "bugfix"
        assert record["impact_level"] == "high"
        assert record["tags"] == ["python", "api"]
        assert record["context"] == "side_project"
        assert record["project"] == "cool-app"


# ---------------------------------------------------------------------------
# get_accomplishments
# ---------------------------------------------------------------------------

class TestGetAccomplishments:
    def test_returns_all_when_no_filter(self, tmp_db):
        _log(tmp_db, title="A")
        _log(tmp_db, title="B")
        assert len(db.get_accomplishments(tmp_db)) == 2

    def test_filter_by_project(self, tmp_db):
        _log(tmp_db, title="A", project="app-one")
        _log(tmp_db, title="B", project="app-two")
        _log(tmp_db, title="C")

        results = db.get_accomplishments(tmp_db, project="app-one")
        assert len(results) == 1
        assert results[0]["title"] == "A"

    def test_filter_by_project_no_match(self, tmp_db):
        _log(tmp_db, project="app-one")
        assert db.get_accomplishments(tmp_db, project="nonexistent") == []

    def test_filter_project_combined_with_category(self, tmp_db):
        _log(tmp_db, title="A", category="feature", project="app-one")
        _log(tmp_db, title="B", category="bugfix", project="app-one")
        _log(tmp_db, title="C", category="feature", project="app-two")

        results = db.get_accomplishments(tmp_db, category="feature", project="app-one")
        assert len(results) == 1
        assert results[0]["title"] == "A"

    def test_null_project_not_matched_by_filter(self, tmp_db):
        _log(tmp_db, title="has project", project="app-one")
        _log(tmp_db, title="no project")

        results = db.get_accomplishments(tmp_db, project="app-one")
        assert all(r["project"] == "app-one" for r in results)


# ---------------------------------------------------------------------------
# search_accomplishments
# ---------------------------------------------------------------------------

class TestSearchAccomplishments:
    def test_search_by_project_name(self, tmp_db):
        _log(tmp_db, title="Other", project="daily-accomplishments")
        _log(tmp_db, title="Unrelated", project="other-app")

        results = db.search_accomplishments(tmp_db, "daily-accomplishments")
        assert len(results) == 1
        assert results[0]["project"] == "daily-accomplishments"

    def test_search_by_title_still_works(self, tmp_db):
        _log(tmp_db, title="Refactored auth module")
        results = db.search_accomplishments(tmp_db, "auth")
        assert len(results) == 1

    def test_search_by_description_still_works(self, tmp_db):
        _log(tmp_db, description="Fixed a race condition in the scheduler")
        results = db.search_accomplishments(tmp_db, "scheduler")
        assert len(results) == 1

    def test_search_partial_project_match(self, tmp_db):
        _log(tmp_db, project="daily-accomplishments")
        results = db.search_accomplishments(tmp_db, "daily")
        assert len(results) == 1


# ---------------------------------------------------------------------------
# update_accomplishment
# ---------------------------------------------------------------------------

class TestUpdateAccomplishment:
    def test_set_project_on_existing_record(self, tmp_db):
        record = _log(tmp_db)
        assert record["project"] is None

        updated = db.update_accomplishment(tmp_db, record["id"], project="new-project")
        assert updated["project"] == "new-project"

    def test_update_project_does_not_change_other_fields(self, tmp_db):
        record = _log(tmp_db, title="Original title", category="feature")

        updated = db.update_accomplishment(tmp_db, record["id"], project="some-project")
        assert updated["title"] == "Original title"
        assert updated["category"] == "feature"

    def test_update_other_fields_does_not_change_project(self, tmp_db):
        record = _log(tmp_db, project="my-app")

        updated = db.update_accomplishment(tmp_db, record["id"], title="New title")
        assert updated["project"] == "my-app"

    def test_returns_none_for_missing_id(self, tmp_db):
        result = db.update_accomplishment(tmp_db, 9999, title="Ghost")
        assert result is None

    def test_returns_none_when_no_fields_provided(self, tmp_db):
        record = _log(tmp_db)
        result = db.update_accomplishment(tmp_db, record["id"])
        assert result is None


# ---------------------------------------------------------------------------
# get_summary
# ---------------------------------------------------------------------------

class TestGetSummary:
    def test_by_project_key_present(self, tmp_db):
        summary = db.get_summary(tmp_db, "all_time")
        assert "by_project" in summary

    def test_by_project_counts_correctly(self, tmp_db):
        _log(tmp_db, project="app-one")
        _log(tmp_db, project="app-one")
        _log(tmp_db, project="app-two")

        summary = db.get_summary(tmp_db, "all_time")
        assert summary["by_project"]["app-one"] == 2
        assert summary["by_project"]["app-two"] == 1

    def test_null_project_excluded_from_by_project(self, tmp_db):
        _log(tmp_db, project="app-one")
        _log(tmp_db)  # no project

        summary = db.get_summary(tmp_db, "all_time")
        assert None not in summary["by_project"]
        assert "None" not in summary["by_project"]

    def test_empty_by_project_when_no_projects_set(self, tmp_db):
        _log(tmp_db)
        _log(tmp_db)

        summary = db.get_summary(tmp_db, "all_time")
        assert summary["by_project"] == {}

    def test_total_includes_records_without_project(self, tmp_db):
        _log(tmp_db, project="app-one")
        _log(tmp_db)  # no project

        summary = db.get_summary(tmp_db, "all_time")
        assert summary["total"] == 2


# ---------------------------------------------------------------------------
# execute_merge
# ---------------------------------------------------------------------------

class TestExecuteMerge:
    def test_project_preserved_through_merge(self, tmp_db, tmp_path):
        _log(tmp_db, title="A", project="app-one")
        _log(tmp_db, title="B", project="app-two")

        out = str(tmp_path / "merged.db")
        records = db.get_accomplishments(tmp_db)
        db.execute_merge(records, out)

        merged = db.get_accomplishments(out)
        projects = {r["project"] for r in merged}
        assert "app-one" in projects
        assert "app-two" in projects

    def test_null_project_preserved_through_merge(self, tmp_db, tmp_path):
        _log(tmp_db, title="with project", project="app-one")
        _log(tmp_db, title="no project")

        out = str(tmp_path / "merged.db")
        records = db.get_accomplishments(tmp_db)
        db.execute_merge(records, out)

        merged = db.get_accomplishments(out)
        assert any(r["project"] is None for r in merged)

    def test_record_count_matches_source(self, tmp_db, tmp_path):
        _log(tmp_db, title="A", project="app-one")
        _log(tmp_db, title="B")
        _log(tmp_db, title="C", project="app-two")

        out = str(tmp_path / "merged.db")
        records = db.get_accomplishments(tmp_db)
        db.execute_merge(records, out)

        assert len(db.get_accomplishments(out)) == 3

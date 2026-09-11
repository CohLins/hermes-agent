"""Tests for the rich skill listing the api_server capability endpoints serve.

``_find_all_skills`` and ``list_skills_detailed`` share ONE scan (and one
cache) but expose different views. The contract worth protecting:

  * ``_find_all_skills`` keeps returning exactly three keys — the prompt
    builder and ``hermes skills`` have always received that shape, and a
    widened dict would silently change what the model sees.
  * ``list_skills_detailed`` adds management metadata, and reports missing
    env var NAMES only — never values.
"""

import pytest

import tools.skills_tool as st


@pytest.fixture(autouse=True)
def _fresh_cache(monkeypatch, tmp_path):
    """Same isolation as the discovery-cache tests: empty external dirs,
    a tmp skills root, nothing disabled, and no ambient .env."""
    st._SKILLS_CACHE.clear()
    monkeypatch.setattr(st, "_skills_dir", lambda: tmp_path / "skills")
    monkeypatch.setattr("agent.skill_utils.get_external_skills_dirs", lambda: [])
    monkeypatch.setattr(st, "_get_disabled_skill_names", lambda: set())
    monkeypatch.setattr(st, "load_env", lambda: {})
    monkeypatch.setattr(st, "_bundled_skill_names", lambda: set())
    yield
    st._SKILLS_CACHE.clear()


def _write_skill(root, category, name, body="# heading\n", **frontmatter):
    d = root / "skills" / category / name
    d.mkdir(parents=True, exist_ok=True)
    lines = [f"name: {name}", "description: a skill"]
    lines.extend(f"{key}: {value}" for key, value in frontmatter.items())
    front = "\n".join(lines)
    (d / "SKILL.md").write_text(f"---\n{front}\n---\n{body}", encoding="utf-8")
    return d


def test_find_all_skills_keeps_its_three_key_shape(tmp_path):
    """The summary view must not leak the scan's extra fields."""
    _write_skill(tmp_path, "cat-a", "skill-one", version="1.2.3")

    listed = st._find_all_skills()

    assert [sorted(s.keys()) for s in listed] == [["category", "description", "name"]]


def test_find_all_skills_still_hands_out_mutable_copies(tmp_path):
    """web_server annotates s['enabled']/s['usage'] on the result."""
    _write_skill(tmp_path, "cat-a", "skill-one")

    first = st._find_all_skills()
    first[0]["enabled"] = False

    assert "enabled" not in st._find_all_skills()[0], "cache poisoned by caller mutation"


def test_detailed_listing_reports_version_tags_and_provenance(tmp_path, monkeypatch):
    _write_skill(
        tmp_path,
        "autonomous-ai-agents",
        "claude-code",
        version="2.2.0",
        metadata="{hermes: {tags: [Coding-Agent, PTY]}}",
    )
    _write_skill(tmp_path, "misc", "hand-written")
    monkeypatch.setattr(st, "_bundled_skill_names", lambda: {"claude-code"})

    by_name = {s["name"]: s for s in st.list_skills_detailed()}

    assert by_name["claude-code"]["version"] == "2.2.0"
    assert by_name["claude-code"]["tags"] == ["Coding-Agent", "PTY"]
    assert by_name["claude-code"]["category"] == "autonomous-ai-agents"
    assert by_name["claude-code"]["provenance"] == "bundled"
    assert by_name["claude-code"]["readiness"] == "available"
    # Not in the bundled manifest => user-authored or hub-installed.
    assert by_name["hand-written"]["provenance"] == "custom"
    assert by_name["hand-written"]["version"] is None


def test_detailed_listing_flags_setup_needed_without_leaking_values(tmp_path, monkeypatch):
    _write_skill(
        tmp_path,
        "productivity",
        "airtable",
        required_environment_variables="[AIRTABLE_API_KEY]",
    )
    monkeypatch.setattr(st, "load_env", lambda: {})

    entry = st.list_skills_detailed()[0]

    assert entry["readiness"] == "setup_needed"
    assert entry["missing_env"] == ["AIRTABLE_API_KEY"]

    # Once the var is set, readiness flips — and it is read live, not from the
    # scan cache (setting a secret bumps no SKILL.md mtime).
    monkeypatch.setattr(st, "load_env", lambda: {"AIRTABLE_API_KEY": "tok"})
    refreshed = st.list_skills_detailed()[0]
    assert refreshed["readiness"] == "available"
    assert refreshed["missing_env"] == []


def test_detailed_listing_include_disabled_flags_instead_of_dropping(tmp_path, monkeypatch):
    _write_skill(tmp_path, "cat-a", "on-skill")
    _write_skill(tmp_path, "cat-a", "off-skill")
    monkeypatch.setattr(st, "_get_disabled_skill_names", lambda: {"off-skill"})

    default_names = [s["name"] for s in st.list_skills_detailed()]
    assert default_names == ["on-skill"], "disabled skills must stay out by default"

    everything = {s["name"]: s["enabled"] for s in st.list_skills_detailed(include_disabled=True)}
    assert everything == {"on-skill": True, "off-skill": False}


def test_detailed_listing_honors_explicit_platform(tmp_path, monkeypatch):
    """The api_server handler pins platform='api_server' rather than letting
    the disabled-set be inferred from env vars."""
    _write_skill(tmp_path, "cat-a", "platform-off")
    seen = []

    def _fake(platform=None):
        seen.append(platform)
        return {"platform-off"}

    monkeypatch.setattr("agent.skill_utils.get_disabled_skill_names", _fake)

    listed = st.list_skills_detailed(include_disabled=True, platform="api_server")

    # include_disabled skips the scan-time filter, so the set is resolved once —
    # for the enabled flag — and always with the platform the caller pinned.
    assert seen == ["api_server"]
    assert listed[0]["enabled"] is False

    # The filtering path resolves it too, same explicit platform.
    seen.clear()
    st._SKILLS_CACHE.clear()
    assert st.list_skills_detailed(platform="api_server") == []
    assert seen == ["api_server"]


def test_read_skill_document_returns_body_and_metadata(tmp_path):
    _write_skill(tmp_path, "github", "gh-flow", body="# GitHub\n\nbody text\n", version="1.4.0")

    document = st.read_skill_document("gh-flow")

    assert document["name"] == "gh-flow"
    assert document["version"] == "1.4.0"
    assert "body text" in document["content"]
    assert document["truncated"] is False
    # The caller serving this to a browser must not be handed a filesystem path.
    assert "path" not in document


def test_read_skill_document_resolves_frontmatter_name_not_dir_name(tmp_path):
    """_find_skill matches directory names; the listing exposes frontmatter
    names. When they disagree, the client only ever knows the latter."""
    d = tmp_path / "skills" / "misc" / "folder-name"
    d.mkdir(parents=True)
    (d / "SKILL.md").write_text(
        "---\nname: declared-name\ndescription: d\n---\n# body\n", encoding="utf-8"
    )

    assert st.read_skill_document("declared-name")["name"] == "declared-name"
    assert st.read_skill_document("folder-name") is None


def test_read_skill_document_truncates_oversized_body(tmp_path):
    _write_skill(tmp_path, "misc", "huge", body="x" * 5000)

    document = st.read_skill_document("huge", max_bytes=1024)

    assert document["truncated"] is True
    assert len(document["content"].encode("utf-8")) <= 1024


def test_read_skill_document_finds_disabled_skills(tmp_path, monkeypatch):
    """A management UI lists disabled skills, so it must be able to open them."""
    _write_skill(tmp_path, "cat-a", "off-skill")
    monkeypatch.setattr(st, "_get_disabled_skill_names", lambda: {"off-skill"})

    assert st.read_skill_document("off-skill") is not None


def test_read_skill_document_rejects_traversal_names(tmp_path):
    with pytest.raises(ValueError, match="traversal"):
        st.read_skill_document("../escape")
    with pytest.raises(ValueError, match="relative path"):
        st.read_skill_document("/etc/passwd")


def test_read_skill_document_missing_skill_returns_none(tmp_path):
    assert st.read_skill_document("no-such-skill") is None

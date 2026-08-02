#!/usr/bin/env python3
"""One-off opt-in migration: V1 flat .md layout -> V2 item folders (prompt.md + prompt.json).

Mapping (from spec p5a):
  agent/*.md            -> {name}/prompt.md          (+ prompt.json, tags from mdMeta)
  system/*.md           -> {name}/prompt.md          (+ prompt.json, tags from mdMeta)
  _skills/*.md          -> _skills/{name}/prompt.md  (+ prompt.json, tags from mdMeta)
  systemPromptBase.md   -> _SystemBase/systemPromptBase/prompt.md  (copy; keep original for V1 builder)

Non-destructive: copies only, never deletes. Originals remain until V1 decommission.
"""
import json
import os
import shutil
import sys
from datetime import datetime

def migrate(data_dir: str) -> None:
    mds = os.path.join(data_dir, "mds")
    if not os.path.isdir(mds):
        print(f"  [skip] {mds} missing")
        return

    # mdMeta.json tags lookup (V1 index) keyed by relative path
    tags_by_path: dict[str, list[str]] = {}
    meta_path = os.path.join(mds, "mdMeta.json")
    if os.path.exists(meta_path):
        try:
            with open(meta_path, "r", encoding="utf-8") as f:
                meta = json.load(f)
            for entries in meta.get("entries", {}).values():
                for e in entries:
                    tags_by_path[e.get("path", "")] = list(e.get("tags", []))
        except Exception as err:
            print(f"  [warn] unreadable mdMeta.json: {err}")

    def make_item(rel_md: str, item_rel_dir: str, item_name: str) -> bool:
        """Copy rel_md into item folder as prompt.md, write prompt.json with tags."""
        src = os.path.join(mds, rel_md)
        if not os.path.isfile(src):
            return False
        folder = os.path.join(mds, item_rel_dir, item_name)
        os.makedirs(folder, exist_ok=True)
        prompt_md = os.path.join(folder, "prompt.md")
        if os.path.exists(prompt_md):
            print(f"  [skip] {item_rel_dir}/{item_name} already has prompt.md")
            return False
        shutil.copy2(src, prompt_md)
        now = datetime.now().astimezone().isoformat()
        tags = tags_by_path.get(rel_md, [])
        prompt_json = os.path.join(folder, "prompt.json")
        with open(prompt_json, "w", encoding="utf-8") as f:
            json.dump({"createdAt": now, "updatedAt": now, "tags": tags}, f, indent=2)
            f.write("\n")
        print(f"  [ok] {rel_md} -> {item_rel_dir}/{item_name}/prompt.md tags={tags}")
        return True

    print(f"=== {mds} ===")

    # agent/*.md -> {name}/
    agent_dir = os.path.join(mds, "agent")
    if os.path.isdir(agent_dir):
        for name in sorted(os.listdir(agent_dir)):
            if name.lower().endswith(".md"):
                stem = name[:-3]
                make_item(f"agent/{name}", "", stem)

    # system/*.md -> {name}/
    system_dir = os.path.join(mds, "system")
    if os.path.isdir(system_dir):
        for name in sorted(os.listdir(system_dir)):
            if name.lower().endswith(".md"):
                stem = name[:-3]
                make_item(f"system/{name}", "", stem)

    # _skills/*.md -> _skills/{name}/
    skills_dir = os.path.join(mds, "_skills")
    if os.path.isdir(skills_dir):
        for name in sorted(os.listdir(skills_dir)):
            if name.lower().endswith(".md"):
                stem = name[:-3]
                make_item(f"_skills/{name}", "_skills", stem)

    # systemPromptBase.md -> _SystemBase/systemPromptBase/prompt.md
    # (_SystemBase is a container: the prompt lives in a sub-folder, like _skills)
    base_src = os.path.join(mds, "systemPromptBase.md")
    base_dir = os.path.join(mds, "_SystemBase", "systemPromptBase")
    base_dst = os.path.join(base_dir, "prompt.md")
    if os.path.isfile(base_src) and not os.path.exists(base_dst):
        os.makedirs(base_dir, exist_ok=True)
        shutil.copy2(base_src, base_dst)
        now = datetime.now().astimezone().isoformat()
        with open(os.path.join(base_dir, "prompt.json"), "w", encoding="utf-8") as f:
            json.dump({"createdAt": now, "updatedAt": now, "tags": ["global"]}, f, indent=2)
            f.write("\n")
        print(f"  [ok] systemPromptBase.md -> _SystemBase/systemPromptBase/prompt.md")
    elif os.path.exists(base_dst):
        print(f"  [skip] _SystemBase/systemPromptBase/prompt.md already exists")

def fix_config_paths(data_dir: str) -> None:
    """Update agent config.json paths: V1 flat .md -> V2 item folder prompt.md."""
    cfg = os.path.join(data_dir, "config.json")
    if not os.path.isfile(cfg):
        return
    try:
        d = json.load(open(cfg, "r", encoding="utf-8"))
    except Exception as e:
        print(f"  [warn] can't read config.json: {e}")
        return
    agents = d.get("agents", {})
    changed = False
    for k, a in agents.items():
        amd = a.get("agentMd", {})
        path = amd.get("path", "")
        if path and "/agent/" in path:
            amd["path"] = path.replace("/agent/", "/").replace(".md", "/prompt.md")
            changed = True
            print(f"  config: {k} agentMd.path -> {amd['path']}")
        skills = a.get("skillMds", [])
        for si, s in enumerate(skills):
            if not isinstance(s, dict):
                continue
            path = s.get("path", "")
            if path and ("/skill/" in path or "/_skills/" in path):
                s["path"] = path.replace("/skill/", "/_skills/").replace(".md", "/prompt.md")
                changed = True
                print(f"  config: {k} skillMds[{si}].path -> {s['path']}")
    if changed:
        with open(cfg, "w", encoding="utf-8") as f:
            json.dump(d, f, indent=2)
            f.write("\n")
        print(f"  config: updated {cfg}")

if __name__ == "__main__":
    for d in sys.argv[1:]:
        migrate(d)
        fix_config_paths(d)

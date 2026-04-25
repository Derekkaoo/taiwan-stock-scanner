import json, sys
sys.path.insert(0, '..')
from scripts.run_pipeline import MONEYDJ_TO_GROUP, INDUSTRY_TO_GROUP, NAME_KEYWORD
from collections import Counter

stocks = json.load(open(r'..\frontend\public\data\stocks.json', encoding='utf-8'))
moneydj_map = json.load(open(r'..\backend\db\stock_industry_map.json', encoding='utf-8'))

def assign_moneydj_only(sid, name, industry):
    # 只用 MoneyDJ 細產業
    entry = moneydj_map.get(sid)
    if entry:
        for sub in entry.get("sub_industries", []):
            sub_name = sub.get("name", "")
            if sub_name in MONEYDJ_TO_GROUP:
                return MONEYDJ_TO_GROUP[sub_name]
    return "其他/未分組"

results = []
for s in stocks:
    group = assign_moneydj_only(s['id'], s['name'], s.get('industry', ''))
    results.append((s['id'], s['name'], group))

groups = Counter(r[2] for r in results)
print("族群分布：")
for g, cnt in groups.most_common():
    print(f"  {cnt:3d} 支  {g}")

print()
print("=== 其他/未分組 的細產業 ===")
for sid, name, group in results:
    if group == "其他/未分組":
        entry = moneydj_map.get(sid, {})
        subs = [s['name'] for s in entry.get("sub_industries", [])]
        print(f"  {sid} {name} → {subs[:3]}")
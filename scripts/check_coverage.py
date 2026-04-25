import json

stocks = json.load(open(r'../frontend/public/data/stocks.json', encoding='utf-8'))
stock_map = json.load(open(r'../backend/db/stock_industry_map.json', encoding='utf-8'))

unclassified = [s for s in stocks if s['group'] == '其他/未分組']
print(f'其他/未分組：{len(unclassified)} 支\n')

for s in unclassified:
    sid = s['id']
    name = s['name']
    industries = stock_map.get(sid, {}).get('sub_industries', [])
    industry_names = [i['name'] for i in industries]
    print(f'{sid} {name}')
    print(f'  → {", ".join(industry_names) if industry_names else "無資料"}')
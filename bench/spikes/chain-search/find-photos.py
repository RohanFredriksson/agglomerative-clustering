# Lists large (12-24 MP) JPEG originals with free licences in some Wikimedia Commons categories. Usage: python3 find-photos.py
import json, urllib.request, urllib.parse, sys
cats = ["Category:Featured pictures of landscapes","Category:Featured pictures of skies","Category:Featured pictures of night","Category:Featured pictures of cityscapes","Category:Featured pictures of plants","Category:Featured pictures of people","Category:CC-Zero","Category:Public domain photographs","Category:Featured pictures of forests","Category:Featured pictures of mountains","Category:Featured pictures of sunsets","Category:Featured pictures of urban landscapes","Category:Featured pictures of Earth"]
def api(**p):
    p['format']='json'
    u='https://commons.wikimedia.org/w/api.php?'+urllib.parse.urlencode(p)
    return json.load(urllib.request.urlopen(urllib.request.Request(u,headers={'User-Agent':'photo-finder/0.1'}),timeout=30))
seen=set()
for c in cats:
    cont={}
    for page in range(4):
        try: r=api(action='query',generator='categorymembers',gcmtitle=c,gcmtype='file',gcmlimit=50,prop='imageinfo',iiprop='size|url|mime|extmetadata',iiextmetadatafilter='LicenseShortName',**cont)
        except Exception as e: print('ERR',c,e); break
        for p in r.get('query',{}).get('pages',{}).values():
            ii=p['imageinfo'][0]; mp=ii['width']*ii['height']/1e6
            if ii['mime']=='image/jpeg' and 12<=mp<=24 and p['title'] not in seen:
                seen.add(p['title']); print(c.split(':')[1],'|',p['title'],'|',round(mp,1),'|',ii['extmetadata'].get('LicenseShortName',{}).get('value'),'|',ii['size'])
        if 'continue' in r: cont=r['continue']
        else: break

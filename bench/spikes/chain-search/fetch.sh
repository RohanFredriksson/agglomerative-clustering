#!/usr/bin/env bash
# Downloads the photos listed in photos.tsv from Wikimedia Commons (original files) into data/, slowly (rate limits), and
# writes sources.txt. Usage: fetch.sh
cd "$(dirname "$0")"; mkdir -p data
printf "# id <TAB> Wikimedia Commons file page (original file downloaded via Special:FilePath) <TAB> licence as shown by Commons <TAB> subject\n" > sources.txt
while IFS=$'\t' read -r id title what lic; do
  url="https://commons.wikimedia.org/wiki/Special:FilePath/$(python3 -c 'import sys,urllib.parse;print(urllib.parse.quote(sys.argv[1].replace(" ","_")))' "$title")"
  [ -s data/$id.jpg ] || { curl -sL -m 300 -A 'photo-fetch/0.1' -o data/$id.jpg "$url"; sleep 10; }
  page="https://commons.wikimedia.org/wiki/File:$(python3 -c 'import sys,urllib.parse;print(urllib.parse.quote(sys.argv[1].replace(" ","_")))' "$title")"
  printf '%s\t%s\t%s\t%s\n' "$id" "$page" "$lic" "$what" >> sources.txt
done < photos.tsv

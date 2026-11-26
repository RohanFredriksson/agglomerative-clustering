#!/usr/bin/env python3
"""README.tmpl.md with each @@file@@ replaced by that file's contents: python3 render-readme.py > README.md"""
import re, sys
t = open('README.tmpl.md').read()
sys.stdout.write(re.sub(r'@@(.+?)@@', lambda m: open(m.group(1)).read().strip('\n'), t))

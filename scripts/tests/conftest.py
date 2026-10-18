"""Coloca a pasta scripts/ no sys.path para importar export_excel."""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

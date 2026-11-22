"""Write the OpenAPI schema to a file: python -m app.export_openapi ../docs/openapi.json"""

import json
import sys
from pathlib import Path

from app.main import create_app


def main() -> None:
    if len(sys.argv) != 2:
        sys.exit("usage: python -m app.export_openapi <output-path>")
    output = Path(sys.argv[1])
    output.parent.mkdir(parents=True, exist_ok=True)
    schema = create_app().openapi()
    output.write_text(json.dumps(schema, indent=2) + "\n", encoding="utf-8", newline="\n")
    print(f"Wrote {output.resolve()}")


if __name__ == "__main__":
    main()

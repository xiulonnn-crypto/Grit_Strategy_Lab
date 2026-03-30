from __future__ import annotations

import uvicorn

from .api import create_app

app = create_app()


def main() -> None:
    uvicorn.run(app, host='0.0.0.0', port=8000)


if __name__ == '__main__':
    main()

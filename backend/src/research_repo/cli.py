"""Command-line administration: ``python -m research_repo.cli create-owner``."""

import argparse
import asyncio
import getpass
import sys
from collections.abc import Sequence

from research_repo.core.config import get_settings
from research_repo.core.db import create_engine, create_sessionmaker
from research_repo.core.errors import AppError
from research_repo.services.users import create_owner


async def _create_owner(email: str, password: str, display_name: str) -> None:
    engine = create_engine(get_settings().database_url)
    try:
        async with create_sessionmaker(engine)() as db:
            await create_owner(db, email=email, password=password, display_name=display_name)
    finally:
        await engine.dispose()


def _read_password(from_stdin: bool) -> str:
    if from_stdin:
        return sys.stdin.readline().rstrip("\n")
    password = getpass.getpass("Password: ")
    if getpass.getpass("Repeat password: ") != password:
        raise SystemExit("Passwords do not match.")
    return password


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="research_repo.cli")
    commands = parser.add_subparsers(dest="command", required=True)
    owner = commands.add_parser("create-owner", help="Create the owner account (first user).")
    owner.add_argument("--email", required=True)
    owner.add_argument("--display-name", default="")
    owner.add_argument(
        "--password-stdin",
        action="store_true",
        help="Read the password from the first line of stdin instead of prompting.",
    )
    args = parser.parse_args(argv)

    password = _read_password(args.password_stdin)
    try:
        asyncio.run(_create_owner(args.email, password, args.display_name))
    except AppError as exc:
        print(f"error: {exc.message}", file=sys.stderr)
        return 1
    print(f"Owner {args.email.strip().lower()} created.")
    return 0


if __name__ == "__main__":
    sys.exit(main())

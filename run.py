"""启动入口：双击 start.bat，或命令行 python run.py。"""
import sys

from livesub_local.server import run

if __name__ == "__main__":
    sys.exit(run())

"""Period lock/close errors raised during journal entry posting."""


class PeriodControlError(Exception):
    def __init__(self, error: str, message: str, **extra: str):
        self.payload: dict[str, str] = {"error": error, "message": message, **extra}
        super().__init__(message)

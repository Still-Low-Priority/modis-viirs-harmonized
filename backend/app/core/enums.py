from enum import Enum

class DayNight(Enum):
    DAY = "D"
    NIGHT = "N"

class BatchStatus(Enum):
    PENDING = "pending"
    RUNNING = "running"
    COMPLETED = "completed"
    PARTIAL = "partial"
    FAILED = "failed"

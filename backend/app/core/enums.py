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

class ProcessingMode(str, Enum):
    SP = "SP"
    NRT = "NRT"

class ConfidenceLevel(str, Enum):
    LOW = "low"
    NOMINAL = "nominal"
    HIGH = "high"

class TimeSeriesInterval(str, Enum):
    DAY = "day"
    MONTH = "month"
    YEAR = "year"

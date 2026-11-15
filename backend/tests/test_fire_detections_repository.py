from app.repositories import fire_detections
from app.repositories.fire_detections import INSERT_CHUNK_SIZE, insert_fire_detections


class FakeResult:
    def __init__(self, ids: list[int]) -> None:
        self._ids = ids

    def scalars(self) -> "FakeResult":
        return self

    def all(self) -> list[int]:
        return self._ids


class FakeSession:
    """Records how many rows each statement carried; pretends all were new."""

    def __init__(self) -> None:
        self.rows_per_statement: list[int] = []

    async def execute(self, stmt) -> FakeResult:
        rows = len(stmt._multi_values[0])
        self.rows_per_statement.append(rows)
        return FakeResult(list(range(rows)))


def make_records(count: int) -> list[dict[str, object]]:
    return [{"record_hash": f"{index:064d}"} for index in range(count)]


async def test_insert_returns_zero_without_touching_the_database_for_no_records() -> None:
    session = FakeSession()

    assert await insert_fire_detections(session, []) == 0
    assert session.rows_per_statement == []


async def test_insert_sends_a_small_batch_in_one_statement() -> None:
    session = FakeSession()

    assert await insert_fire_detections(session, make_records(3)) == 3
    assert session.rows_per_statement == [3]


async def test_insert_splits_large_batches_to_stay_under_the_bind_parameter_limit() -> None:
    session = FakeSession()
    count = INSERT_CHUNK_SIZE * 2 + 5

    assert await insert_fire_detections(session, make_records(count)) == count
    assert session.rows_per_statement == [INSERT_CHUNK_SIZE, INSERT_CHUNK_SIZE, 5]


def test_chunk_size_keeps_a_full_row_under_the_asyncpg_limit() -> None:
    columns = len(fire_detections.FireDetection.__table__.columns)

    assert INSERT_CHUNK_SIZE * columns <= 32767

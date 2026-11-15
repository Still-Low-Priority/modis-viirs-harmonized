#FIRMS exceptions
class FIRMSClientError(Exception):
    def __init__(self, message: str) -> None:
        super().__init__(message)

class FIRMSConnectionError(FIRMSClientError):
    status_code = 502
    error_code = 'FIRMS_CONNECTION_ERROR'

class FIRMSHTTPError(FIRMSClientError):
    def __init__(self, message: str, upstream_status_code: int) -> None:
        super().__init__(message)
        self.upstream_status_code = upstream_status_code
    status_code = 502
    error_code = 'FIRMS_HTTP_ERROR' 

class FIRMSTimeoutError(FIRMSClientError):
    status_code = 504
    error_code = 'FIRMS_TIMEOUT_ERROR'

from sqlalchemy import or_

def lon_filter(col, west, east):
    if west <= east:
        return col.between(west, east)
    return or_(col >= west, col <= east)

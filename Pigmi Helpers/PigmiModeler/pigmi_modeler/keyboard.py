"""Keyboard normalization shared by idle shortcuts and modal drawing."""
RU_KEYS = {'а':'F','у':'E','з':'P','м':'V','п':'G'}


def event_key(event):
    char = getattr(event,'unicode','').lower()
    if char in RU_KEYS:
        return RU_KEYS[char]
    if char in {'f','e','p','v','g'}:
        return char.upper()
    return event.type

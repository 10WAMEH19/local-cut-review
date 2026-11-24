"""Bounded background tasks for the local editor."""
from concurrent.futures import ThreadPoolExecutor
from functools import partial
from threading import Lock
from uuid import uuid4

_jobs = {}
_lock = Lock()
_media = ThreadPoolExecutor(max_workers=2, thread_name_prefix='media')
_ai = ThreadPoolExecutor(max_workers=1, thread_name_prefix='analysis')


def status(identifier):
    with _lock:
        job = _jobs.get(identifier)
        return dict(job) if job else None


def _update(identifier, **fields):
    with _lock:
        _jobs[identifier].update(fields)


def submit(label, task, key=None, analysis=False):
    with _lock:
        active = [job for job in _jobs.values() if job['state'] in ('queued', 'running')]
        if key is not None:
            previous = next((job for job in active if job['key'] == key), None)
            if previous:
                return {'job': previous['id']}
        if len(active) >= 32:
            raise ValueError('The processing queue is full. Wait for a video to finish.')
        for old_id in list(_jobs)[:-100]:
            if _jobs[old_id]['state'] in ('ready', 'failed'):
                del _jobs[old_id]
        identifier = uuid4().hex
        _jobs[identifier] = {'id': identifier, 'key': key, 'state': 'queued', 'message': label}

    def run():
        _update(identifier, state='running')
        try:
            result = task(lambda message: _update(identifier, message=message))
        except Exception as error:
            _update(identifier, state='failed', message=str(error)[:500] or 'Processing failed.')
        else:
            _update(identifier, state='ready', result=result)

    (_ai if analysis else _media).submit(run)
    return {'job': identifier}

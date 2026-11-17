import hashlib
import http.client
import json
import tempfile
import threading
import time
import unittest
from http.server import ThreadingHTTPServer
from pathlib import Path
import app
import media
from media_fixture import make_test_video


class LocalServer(unittest.TestCase):
    source_id = 'a' * 32

    @classmethod
    def setUpClass(cls):
        cls.temp = tempfile.TemporaryDirectory()
        cls.addClassCleanup(cls.temp.cleanup)
        cls.addClassCleanup(setattr, app, 'DATA', app.DATA)
        app.DATA = Path(cls.temp.name)
        payload = bytes(range(64))
        (app.DATA / (cls.source_id + '.mp4')).write_bytes(payload)
        (app.DATA / (cls.source_id + '.json')).write_text(json.dumps({'sha256': hashlib.sha256(payload).hexdigest()}))
        cls.server = ThreadingHTTPServer(('127.0.0.1', 0), app.Handler)
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown();cls.server.server_close();cls.thread.join()

    def request(self,path,body=None,headers=None):
        conn=http.client.HTTPConnection('127.0.0.1',self.server.server_port,timeout=30)
        headers=headers or {}
        if isinstance(body,dict):
            body=json.dumps(body).encode();headers={'Content-Type':'application/json',**headers}
        conn.request('POST' if body is not None else 'GET',path,body,headers)
        r=conn.getresponse();status,heads,data=r.status,dict(r.getheaders()),r.read();conn.close()
        return status,heads,data

    def finished(self, data):
        identifier = json.loads(data)['job']
        for _ in range(100):
            status, _, body = self.request('/api/jobs/' + identifier)
            self.assertEqual(status, 200)
            job = json.loads(body)
            if job['state'] in ('failed', 'ready'):
                self.assertEqual(job['state'], 'ready', job)
                return job['result']
            time.sleep(.1)
        self.fail('The media job did not finish.')

    def test_range_support_for_browser_seeking(self):
        status,headers,data=self.request('/media/' + self.source_id,headers={'Range':'bytes=0-31'})
        self.assertEqual(status,206);self.assertEqual(len(data),32)
        self.assertTrue(headers['Content-Range'].startswith('bytes 0-31/'))
        self.assertEqual(data, bytes(range(32)))

    def test_confirmation_and_source_hash_are_checked_on_the_server(self):
        for value, error in [({'cuts': []}, 'confirm'),
                             ({'source_hash': 'stale', 'confirmed': True, 'cuts': []}, 'source changed')]:
            status, _, body = self.request('/api/export', {'source': self.source_id, **value}, {'X-App-Token': app.TOKEN})
            self.assertEqual(status, 400)
            self.assertIn(error, json.loads(body)['error'])

    def test_token_boundary_and_non_media_files(self):
        self.assertEqual(self.request('/api/export',{})[0],403)
        self.assertEqual(self.request('/media/../../README.md')[0],404)
        self.assertEqual(self.request('/local_config.json')[0],404)

    @unittest.skipUnless(media.ffmpeg_path(),'Requires configured FFmpeg')
    def test_real_upload_manual_cut_export_and_original_preservation(self):
        original = make_test_video(app.DATA / 'upload-test.mp4').read_bytes()
        status,_,data=self.request('/api/upload',original,{'X-App-Token':app.TOKEN,'X-Filename':'test-video.mp4'})
        self.assertEqual(status,200);info=json.loads(data)
        payload={'source':info['id'],'source_hash':info['sha256'],'confirmed':True,'cuts':[{'start':2,'end':4}]}
        status,_,data=self.request('/api/export',payload,{'X-App-Token':app.TOKEN})
        self.assertEqual(status,200);result=json.loads(data)
        self.assertAlmostEqual(result['duration'],info['duration']-2,delta=.1)
        self.assertTrue(result['audio']);self.assertTrue(result['original_preserved'])
        self.assertEqual(self.request(result['url'])[0],200)
        self.assertEqual(hashlib.sha256(self.request(info['url'])[2]).hexdigest(),info['sha256'])


if __name__=='__main__':unittest.main()

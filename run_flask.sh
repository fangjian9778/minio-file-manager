#!/bin/bash
cd /Users/jiandan/Downloads/test
echo "Starting Flask on port 5001..."
python3 -u -c "
import minio_server
minio_server.app.run(host='127.0.0.1', port=5001, debug=False, use_reloader=False, threaded=True)
"

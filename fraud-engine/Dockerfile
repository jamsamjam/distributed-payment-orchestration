FROM python:3.12-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY proto/ ./proto/
RUN python -m grpc_tools.protoc \
    -I proto \
    -I /usr/local/lib/python3.12/site-packages/grpc_tools/_proto \
    --python_out=. \
    --grpc_python_out=. \
    proto/fraud.proto

COPY app/ ./app/

EXPOSE 8000 50051

HEALTHCHECK --interval=10s --timeout=5s --retries=15 \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:8000/health')" || exit 1

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]

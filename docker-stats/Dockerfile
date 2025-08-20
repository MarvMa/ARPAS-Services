FROM python:3.12-alpine

WORKDIR /app

RUN pip install --no-cache-dir flask docker requests

ENV DOCKER_HOST=unix:///var/run/docker.sock
COPY server.py .

EXPOSE 3002

CMD ["python", "server.py"]
FROM nginx:1.23-alpine

WORKDIR /etc/nginx

COPY nginx.conf /etc/nginx/nginx.conf

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]

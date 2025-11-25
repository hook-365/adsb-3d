FROM nginx:alpine

# Copy static files
COPY public/ /usr/share/nginx/html/

# Copy tests directory
COPY tests/ /usr/share/nginx/html/tests/

# Copy nginx configurations
COPY nginx/http.conf /etc/nginx/conf.d/00-http.conf
COPY nginx/nginx.conf /etc/nginx/conf.d/default.conf

# Copy entrypoint script
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

EXPOSE 80

ENTRYPOINT ["/entrypoint.sh"]

<template>
  <div class="h-full">
    <LMap
      ref="map"
      style="height: 100%"
      :zoom="12"
      :center="[47.083328, 2.4]"
      :use-global-leaflet="false"
    >
      <LTileLayer
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        attribution="&amp;copy; <a href=&quot;https://www.openstreetmap.org/&quot;>OpenStreetMap</a> contributors"
        layer-type="base"
        name="OpenStreetMap"
      />
    </LMap>
  </div>
</template>

<style scoped>
</style>
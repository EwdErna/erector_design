<template>
  <div class="app-container">
    <nav>
      <Navigation></Navigation>
    </nav>
    <main>
      <section class="left">
        <SelectComponents></SelectComponents>
      </section>
      <section class="main">
        <ThreeDScene></ThreeDScene>
      </section>
      <section class="right">
        <EditComponent></EditComponent>
      </section>
    </main>
    <footer></footer>
  </div>
</template>

<style scoped>
.app-container {
  height: calc(100vh - 16px);

  nav {
    height: 64px;
  }

  footer {
    height: 20px;
  }

  main {
    width: 100%;
    height: calc(100% - 84px);
    display: flex;

    .left {
      width: 25%;
      background-color: #f0f0f0;
    }

    .right {
      width: 25%;
      background-color: #f0f0f0;
    }

    .main {
      width: 50%;
    }
  }
}
</style>
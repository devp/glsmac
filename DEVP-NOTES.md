# local devp notes

needed to fix/remove old 2020 cxx version
sudo mv /Library/Developer/CommandLineTools/usr/include/c++ /Library/Developer/CommandLineTools/usr/include/c++.bak
after brew, cmake cmd -- make -C build -j8 (parallel)
brew install ninja ccache
rm -rf build
cmake -S . -B build -G Ninja -DCMAKE_BUILD_TYPE=Debug \
  -DCMAKE_CXX_COMPILER_LAUNCHER=ccache
ninja -C build
sdl issues
ai trying vs sdl issues on mac
